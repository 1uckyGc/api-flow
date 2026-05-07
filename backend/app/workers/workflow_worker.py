import asyncio
import logging
import uuid
import json
import httpx
from datetime import datetime

from app.workers.celery_app import celery_app
from app.database import SessionLocal
from app.models.workflow import WorkflowRun, WorkflowRunStatus
from app.models.task import TaskGroup, Task, GroupStatus, TaskStatus, TaskSource, TaskType
from app.workers.tasks import process_generation
from app.config import settings

logger = logging.getLogger(__name__)

async def call_workflow_llm(model: str, system_prompt: str, user_prompt: str, count: int) -> list[str]:
    """通用的大模型分发处理 (扩写/变换)"""
    api_key = settings.DEEPSEEK_API_KEY
    base_url = settings.DEEPSEEK_API_URL
    if not api_key:
        raise RuntimeError("系统未配置 DEEPSEEK_API_KEY")

    payload = {
        "model": settings.DEEPSEEK_MODEL if not model else model,
        "messages": [
            {"role": "system", "content": system_prompt or "你是一个创意助手，请按要求输出格式要求的JSON。"},
            {"role": "user", "content": f"{user_prompt}\n\n请严格返回包含 'prompts' 字符串数组的 JSON。如果需要 {count} 条方向，请在数组中放入 {count} 个字符串。示例: {{\"prompts\": [\"...\", \"...\"]}}"}
        ],
        "temperature": 0.8,
        "response_format": {"type": "json_object"}
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(base_url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        
        try:
            parsed = json.loads(content)
            prompts = parsed.get("prompts", [])
            if not isinstance(prompts, list):
                prompts = [str(prompts)]
            
            # 补齐或截断
            if prompts:
                if len(prompts) < count:
                    prompts.extend([prompts[-1]] * (count - len(prompts)))
                elif len(prompts) > count:
                    prompts = prompts[:count]
            return prompts
        except Exception as e:
            logger.error(f"Failed to parse LLM JSON: {content}")
            raise ValueError("大模型未返回合法的 JSON prompts 数组")


def _get_task_type_from_step(step_type: str) -> TaskType:
    mapping = {
        "t2i": TaskType.TEXT_TO_IMAGE,
        "i2i": TaskType.IMAGE_TO_IMAGE,
        "i2v": TaskType.IMAGE_TO_VIDEO,
        "t2v": TaskType.TEXT_TO_VIDEO,
        "extend": TaskType.IMAGE_TO_VIDEO, # 也是生成视频
    }
    return mapping.get(step_type, TaskType.TEXT_TO_IMAGE)


async def async_advance_workflow(run_id: str, step_index: int):
    """异步执行具体的推进逻辑"""
    db = SessionLocal()
    try:
        # 使用写锁确保当前步骤不会被多个 worker 同时执行
        run = db.query(WorkflowRun).with_for_update().filter(WorkflowRun.id == run_id).first()
        if not run:
            logger.error(f"WorkflowRun {run_id} not found")
            return

        workflow = run.workflow
        steps_def = workflow.steps_json

        # 1. 边界检查: 执行完毕
        if step_index >= len(steps_def):
            run.status = WorkflowRunStatus.COMPLETED
            db.commit()
            return

        current_step_state = run.steps_state[step_index]
        if current_step_state["status"] != "pending":
            logger.info(f"Run {run_id} step {step_index} is not pending (status: {current_step_state['status']}), skipping.")
            return

        step_def = steps_def[step_index]
        step_type = step_def.get("type")
        config = step_def.get("config", {})

        # 获取上一阶段的输入数据
        if step_index > 0:
            prev_state = run.steps_state[step_index - 1]
            prev_files = prev_state.get("output_files", [])
            prev_prompts = prev_state.get("output_prompts", [])
        else:
            prev_files = run.input_files or []
            prev_prompts = run.input_prompts or []

        # 标记当前正在执行
        current_step_state["status"] = "running"
        run.steps_state = list(run.steps_state) # 触发 JSON 字段的变更追踪
        run.current_step = step_index
        db.commit()

        # 核心逻辑路由
        try:
            if step_type in ("llm_expand", "llm_transform"):
                model = config.get("model", "")
                sys_prompt = config.get("system_prompt", "")
                user_template = config.get("user_template", "{input_prompt}")
                count = config.get("count", 4)

                # 以当前最后一个有效的 prompt 垫盘
                base_prompt = prev_prompts[0] if prev_prompts else ""
                real_user_prompt = user_template.replace("{input_prompt}", base_prompt)

                results = await call_workflow_llm(model, sys_prompt, real_user_prompt, count)
                
                # 写入状态并递归步进
                current_step_state["status"] = "completed"
                current_step_state["output_prompts"] = results
                current_step_state["output_files"] = prev_files # 透传
                run.steps_state = list(run.steps_state)
                db.commit()
                
                # 直接触发下一步
                advance_workflow.delay(run_id, step_index + 1)

            elif step_type == "review":
                current_step_state["status"] = "waiting"
                # 在审核模式时，产出先留空，等待前端提交 `/review` API 时写入
                run.steps_state = list(run.steps_state)
                run.status = WorkflowRunStatus.PAUSED
                db.commit()
                # 暂停流转，等待外部打破 (routers/workflows.py 中 `/review` 接口)

            elif step_type in ("t2i", "i2i", "i2v", "t2v", "extend"):
                # 创建 TaskGroup
                is_extend = (step_type == "extend")
                task_type = _get_task_type_from_step(step_type)
                
                # 构建 Group
                group = TaskGroup(
                    id=str(uuid.uuid4()),
                    user_id=run.user_id,
                    title=f"{run.title} - Step {step_index+1} ({step_def.get('label', step_type)})",
                    task_type=task_type,
                    source=TaskSource.PIPELINE,
                    status=GroupStatus.PENDING,
                    workflow_run_id=run.id,
                    workflow_step_index=step_index,
                    config_json={
                        "model": config.get("model", ""),
                        "aspect_ratio": config.get("aspect_ratio", "16:9"),
                        "isExtension": is_extend
                    }
                )
                db.add(group)

                # 构建具体任务子集 (笛卡尔积思路 或 文件优先映射)
                db_tasks = []
                images_per_prompt = config.get("images_per_prompt", 1)
                
                # 对于文件优先类(i2i/i2v/extend), 用 prev_files 循环
                if task_type in (TaskType.IMAGE_TO_IMAGE, TaskType.IMAGE_TO_VIDEO) or is_extend:
                    if not prev_files:
                        raise ValueError(f"{step_type} 需要文件输入但输入为空")
                    
                    for f_path in prev_files:
                        for idx in range(images_per_prompt):
                            # 使用同位置的 prompt，如果不够就用最后一条，如果没有就留空
                            default_p = prev_prompts[-1] if prev_prompts else ""
                            db_task = Task(
                                id=str(uuid.uuid4()),
                                group_id=group.id,
                                user_id=run.user_id,
                                prompt=default_p,
                                input_files=[f_path],
                                status=TaskStatus.QUEUED,
                            )
                            db_tasks.append(db_task)
                            db.add(db_task)
                else:
                    # 对于纯文本引导类(t2i/t2v), 用 prev_prompts 循环
                    if not prev_prompts:
                        raise ValueError(f"{step_type} 需要提示词输入但为空")
                        
                    for p in prev_prompts:
                        for idx in range(images_per_prompt):
                            db_task = Task(
                                id=str(uuid.uuid4()),
                                group_id=group.id,
                                user_id=run.user_id,
                                prompt=p,
                                input_files=[],
                                status=TaskStatus.QUEUED,
                            )
                            db_tasks.append(db_task)
                            db.add(db_task)

                group.total_count = len(db_tasks)
                db.commit()

                current_step_state["task_group_id"] = group.id
                run.steps_state = list(run.steps_state)
                db.commit()

                # 将各子任务压入世代队列
                for t in db_tasks:
                    process_generation.delay(t.id)

            else:
                # input 等静态节点，直接透传 (通常不会在 worker 里处理)
                current_step_state["status"] = "completed"
                current_step_state["output_prompts"] = prev_prompts
                current_step_state["output_files"] = prev_files
                run.steps_state = list(run.steps_state)
                db.commit()
                advance_workflow.delay(run_id, step_index + 1)

        except Exception as step_err:
            logger.error(f"Error in step {step_index}: {step_err}")
            current_step_state["status"] = "failed"
            current_step_state["error"] = str(step_err)
            run.steps_state = list(run.steps_state)
            run.status = WorkflowRunStatus.FAILED
            run.error_message = f"Step {step_index + 1} failed: {step_err}"
            db.commit()
            
    except Exception as e:
        logger.error(f"Error in advance_workflow for run {run_id}: {e}")
        db.rollback()
    finally:
        db.close()


@celery_app.task(bind=True, name="app.workers.workflow_worker.advance_workflow")
def advance_workflow(self, run_id: str, step_index: int):
    """Celery worker 入口函数：负责工作流步骤的推进"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(async_advance_workflow(run_id, step_index))
    finally:
        loop.close()
