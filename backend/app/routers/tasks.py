from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
import uuid
import asyncio
import os

from app.database import get_db
from app.models.user import User
from app.models.task import Task, TaskGroup, TaskType, GroupStatus, TaskStatus, TaskSource
from app.schemas.task import TaskGroupCreate, TaskGroupResponse, TaskGroupListResponse, TaskBase
from app.routers.auth import get_current_user
from app.workers.tasks import process_generation, update_group_status, notify_ws
from app.utils.file_cleanup import remove_task_output, remove_tasks_outputs
from app.models.api_call_log import ApiCallLog


def _unbind_api_call_logs(db: Session, task_ids=None, group_ids=None) -> None:
    """删除 Task/Group 之前，把 ApiCallLog 上的 FK 置 NULL 避免外键违例。
    审计行保留不删，跟 cleanup_tasks.purge_old_artifacts 同范式。
    """
    if task_ids:
        db.query(ApiCallLog).filter(ApiCallLog.task_id.in_(task_ids)).update(
            {"task_id": None}, synchronize_session=False
        )
    if group_ids:
        db.query(ApiCallLog).filter(ApiCallLog.group_id.in_(group_ids)).update(
            {"group_id": None}, synchronize_session=False
        )
    db.flush()

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

from app.services.ai_service import generate_fission_prompts
from app.prompts import IMAGE_PROMPT_FINAL_TEMPLATE, IMAGE_PROMPT_BASE_INSTRUCTION, DEFAULT_SYSTEM_CONSTRAINT

@router.post("/", response_model=TaskGroupResponse)
async def create_task_group(
    task_group_in: TaskGroupCreate, 
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    if not task_group_in.tasks:
        raise HTTPException(status_code=400, detail="任务列表不能为空")
        
    # 提取可能的裂变血缘追踪字段 (前端放在 config_json 中传递)
    f_parent = task_group_in.config_json.get("fission_parent_id")
    f_stage = task_group_in.config_json.get("fission_stage")

    db_group = TaskGroup(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=task_group_in.title,
        task_type=task_group_in.task_type,
        source=task_group_in.source,
        global_prompt=task_group_in.global_prompt,
        config_json=task_group_in.config_json,
        fission_parent_id=f_parent,
        fission_stage=f_stage,
        total_count=len(task_group_in.tasks),
        status=GroupStatus.PENDING
    )
    db.add(db_group)
    db.commit()
    db.refresh(db_group)

    # ==========================================
    # 核心拦截路口：裂变模式的源头
    # - TEXT_TO_IMAGE：老形态（产品图 → LLM 扩 N → i2i 出 N 张图）保留以兼容已存在的 group
    # - IMAGE_TO_VIDEO：新形态（产品图 → Doubao 洗稿 N → i2v 直接出 N 个视频）
    # ==========================================
    if task_group_in.source == TaskSource.FISSION and task_group_in.task_type in (
        TaskType.TEXT_TO_IMAGE, TaskType.IMAGE_TO_VIDEO
    ):
        background_tasks.add_task(
            expand_fission_task_group,
            db_group.id,
            task_group_in,
            current_user.id
        )
        return db_group
    else:
        # 普通基础工具箱调用、或裂变选图生视频/生延展，原样放行，不再二次发散
        actual_tasks_to_create = task_group_in.tasks
        
        # 插入子任务并发送到 Celery
        db_tasks = []
        for t_in in actual_tasks_to_create:
            db_task = Task(
                id=str(uuid.uuid4()),
                group_id=db_group.id,
                user_id=current_user.id,
                prompt=t_in.prompt,
                input_files=t_in.input_files,
                status=TaskStatus.QUEUED,
                config_json={}
            )
            db_tasks.append(db_task)
            db.add(db_task)
        
        db.commit()

        # Dreamina Seedance 必须串行执行（单账户并行会撞并发上限）
        # 检测 group 级 model；命中则全组走专属 batch task，单条投递一次
        group_model = (db_group.config_json or {}).get("model", "") if db_group.config_json else ""
        if group_model.startswith("dreamina/seedance"):
            from app.workers.dreamina_batch import run_dreamina_serial_batch
            run_dreamina_serial_batch.delay(db_group.id)
        else:
            for db_task in db_tasks:
                process_generation.delay(db_task.id)

        db.commit()
        db.refresh(db_group)
        return db_group

from app.workers.tasks import notify_ws, SessionLocal as WorkerSessionLocal
from app.schemas.task import TaskBase

async def expand_fission_task_group(group_id: str, task_group_in: TaskGroupCreate, user_id: int):
    """后台任务：调用 LLM 裂变提示词并生成子任务"""
    db = WorkerSessionLocal()
    try:
        db_group = db.query(TaskGroup).filter(TaskGroup.id == group_id).first()
        if not db_group: return

        async def update_progress(msg: str):
            db_group.progress_message = msg
            db.commit()
            await notify_ws(user_id, {
                "type": "GROUP_PROGRESS",
                "group_id": group_id,
                "message": msg
            })

        base_task = task_group_in.tasks[0]
        base_input_files = base_task.input_files
        count_needed = task_group_in.config_json.get("count", 4)

        # 1. 呼叫大模型发散创意 (带进度日志，注入多图参考视野)
        try:
            creative_prompts = await generate_fission_prompts(
                global_prompt=task_group_in.global_prompt or "",
                count=count_needed,
                image_paths=base_input_files,
                progress_callback=update_progress
            )
        except Exception as e:
            logger.error(f"Fission prompt expansion failed: {e}")
            db_group.status = GroupStatus.FAILED
            db_group.progress_message = str(e)
            db.commit()
            await notify_ws(user_id, {"type": "TASK_UPDATE"})
            return
        
        # 将原始扩写结果持久化，供 UI 查看详细参数
        if not db_group.config_json:
            db_group.config_json = {}
        # 强制更新 JSON 字段以确保 SQLAlchemy 检出变化
        new_config = dict(db_group.config_json)
        new_config["fission_prompts"] = creative_prompts
        db_group.config_json = new_config
        db.commit()

        # 2. 组装最终任务 —— 按 task_type 分支
        is_video_first = task_group_in.task_type == TaskType.IMAGE_TO_VIDEO
        from app.prompts import IMAGE_PROMPT_FINAL_TEMPLATE, IMAGE_PROMPT_BASE_INSTRUCTION, DEFAULT_SYSTEM_CONSTRAINT

        db_tasks = []
        for c_prompt in creative_prompts:
            if is_video_first:
                # 新形态：Doubao 出来的 prompt 直接当 i2v prompt，全部任务共享同一张产品图
                final_prompt = c_prompt
            else:
                # 老形态：i2i 用 IMAGE_PROMPT_FINAL_TEMPLATE 包裹（产品底线/融合要求/画质要求）
                final_prompt = IMAGE_PROMPT_FINAL_TEMPLATE.format(
                    base_instructions=IMAGE_PROMPT_BASE_INSTRUCTION,
                    system_constraint=DEFAULT_SYSTEM_CONSTRAINT,
                    global_prompt=task_group_in.global_prompt or "",
                    prompt_text=c_prompt
                )

            db_task = Task(
                id=str(uuid.uuid4()),
                group_id=db_group.id,
                user_id=user_id,
                prompt=final_prompt,
                input_files=base_input_files,
                status=TaskStatus.QUEUED,
                config_json={}
            )
            db_tasks.append(db_task)
            db.add(db_task)

        db_group.total_count = len(db_tasks)
        db_group.status = GroupStatus.PROCESSING
        db.commit()

        # 3. 发送给 Celery —— Dreamina Seedance 走串行 batch；其他并行
        group_model = (db_group.config_json or {}).get("model", "")
        if group_model.startswith("dreamina/seedance"):
            from app.workers.dreamina_batch import run_dreamina_serial_batch
            run_dreamina_serial_batch.delay(db_group.id)
        else:
            for t in db_tasks:
                process_generation.delay(t.id)

        db.commit()
        # 通知前端内容已从 PENDING 切换到具体任务流
        await notify_ws(user_id, {"type": "TASK_UPDATE"})

    except Exception as e:
        logger.error(f"Fission expansion failed for {group_id}: {e}")
        db.rollback()
        db_group = db.query(TaskGroup).filter(TaskGroup.id == group_id).first()
        if db_group:
            db_group.status = GroupStatus.FAILED
            db_group.progress_message = f"创意引擎故障: {str(e)}"
            try:
                db.commit()
            except Exception:
                db.rollback()
        await notify_ws(user_id, {"type": "TASK_UPDATE"})
    finally:
        db.close()

from sqlalchemy.orm import joinedload

@router.get("/", response_model=List[TaskGroupListResponse])
def list_task_groups(
    skip: int = 0, 
    limit: int = 500, 
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    groups = db.query(TaskGroup)\
        .options(joinedload(TaskGroup.tasks))\
        .filter(TaskGroup.user_id == current_user.id)\
        .order_by(TaskGroup.created_at.desc())\
        .offset(skip).limit(limit).all()
    
    # 批量查询所有 fission 子组，避免 N+1
    fission_ids = [g.id for g in groups if g.source == TaskSource.FISSION]
    latest_children = {}
    if fission_ids:
        from sqlalchemy import func
        # 子查询：每个 parent 的最新 child
        latest_subq = db.query(
            TaskGroup.fission_parent_id,
            func.max(TaskGroup.created_at).label("max_created")
        ).filter(
            TaskGroup.fission_parent_id.in_(fission_ids)
        ).group_by(TaskGroup.fission_parent_id).subquery()
        
        children = db.query(TaskGroup).join(
            latest_subq,
            (TaskGroup.fission_parent_id == latest_subq.c.fission_parent_id) &
            (TaskGroup.created_at == latest_subq.c.max_created)
        ).all()
        
        for child in children:
            latest_children[child.fission_parent_id] = child
    
    for g in groups:
        if g.source == TaskSource.FISSION and g.id in latest_children:
            child = latest_children[g.id]
            g.fission_stage = child.fission_stage
            g.status = child.status
            g.completed_count = child.completed_count
            g.total_count = child.total_count
            g.failed_count = child.failed_count
                
    return groups

@router.get("/{group_id}", response_model=TaskGroupResponse)
def get_task_group(
    group_id: str, 
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    group = db.query(TaskGroup)\
        .filter(TaskGroup.id == group_id, TaskGroup.user_id == current_user.id)\
        .first()
    if not group:
        raise HTTPException(status_code=404, detail="Task Group not found")
    return group

@router.delete("/{group_id}", status_code=status.HTTP_200_OK)
def delete_task_group(
    group_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    group = db.query(TaskGroup)\
        .filter(TaskGroup.id == group_id, TaskGroup.user_id == current_user.id)\
        .first()
    
    if not group:
        raise HTTPException(status_code=404, detail="Task Group not found")

    remove_tasks_outputs(group.tasks)
    task_ids = [t.id for t in group.tasks]
    _unbind_api_call_logs(db, task_ids=task_ids, group_ids=[group_id])
    db.delete(group)
    db.commit()

    return {"message": "Task group and associated output files deleted successfully"}

@router.delete("/failed/clear/all", status_code=status.HTTP_200_OK)
def clear_failed_tasks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """一键清除当前用户的失败任务 + 长时间无响应的僵尸任务（running/queued >2h）+ 幽灵空壳组。"""
    from datetime import datetime, timedelta
    zombie_cutoff = datetime.utcnow() - timedelta(hours=2)

    # 1. 真 FAILED
    failed_tasks = db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.status == TaskStatus.FAILED
    ).all()

    # 2. 僵尸 RUNNING/QUEUED >2h（worker 崩溃/网络断、永远卡住的任务）
    zombie_tasks = db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.status.in_([TaskStatus.RUNNING, TaskStatus.QUEUED]),
        Task.updated_at < zombie_cutoff,
    ).all()

    to_delete = failed_tasks + zombie_tasks
    count = len(to_delete)
    remove_tasks_outputs(to_delete)
    _unbind_api_call_logs(db, task_ids=[t.id for t in to_delete])
    for task in to_delete:
        db.delete(task)

    db.commit()

    # 清理掉因为删除子任务而彻底变空的闲置批次组
    empty_groups = db.query(TaskGroup).filter(
        TaskGroup.user_id == current_user.id,
        ~TaskGroup.tasks.any()
    ).all()
    empty_group_ids = [g.id for g in empty_groups]
    _unbind_api_call_logs(db, group_ids=empty_group_ids)
    for g in empty_groups:
        db.delete(g)

    db.commit()
    return {
        "message": f"Successfully deleted {count} tasks ({len(failed_tasks)} failed + {len(zombie_tasks)} zombie) and cleaned empty groups",
        "failed": len(failed_tasks),
        "zombies": len(zombie_tasks),
    }

@router.delete("/item/{task_id}", status_code=status.HTTP_200_OK)
async def delete_single_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除单个任务及其物理文件"""
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    remove_task_output(task.output_file)
    remove_task_output(task.output_thumbnail)

    group_id = task.group_id
    _unbind_api_call_logs(db, task_ids=[task_id])
    db.delete(task)
    db.commit()

    # 检查并清理空组
    remaining = db.query(Task).filter(Task.group_id == group_id).count()
    if remaining == 0:
        group = db.query(TaskGroup).filter(TaskGroup.id == group_id).first()
        if group:
            _unbind_api_call_logs(db, group_ids=[group_id])
            db.delete(group)
            db.commit()
    else:
        # 手动触发布局更新与状态同步
        update_group_status(db, group_id)
            
    await notify_ws(current_user.id, {"type": "TASK_UPDATE"})
    return {"message": "Task and associated file deleted"}

from pydantic import BaseModel

class TaskRetryRequest(BaseModel):
    prompt: str | None = None

@router.post("/item/{task_id}/retry", status_code=status.HTTP_200_OK)
async def retry_single_task(
    task_id: str,
    req: TaskRetryRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """针对性重试单张失败卡片，支持重写提示词"""
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 允许修改提示词
    if req and req.prompt and req.prompt.strip():
        task.prompt = req.prompt.strip()

    # 重置状态，清空旧错误
    task.status = TaskStatus.QUEUED
    task.error_message = None
    db.commit()
    
    # 回算组状态并通知 UI
    update_group_status(db, task.group_id)
    
    # 重新压入 Celery 队列
    process_generation.delay(task.id)
    
    await notify_ws(current_user.id, {"type": "TASK_UPDATE"})
    return {"message": "Task retried and pushed back to queue"}

@router.post("/batch-delete", status_code=status.HTTP_200_OK)
def batch_delete_tasks(
    task_ids: List[str],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """批量删除选中的多个任务"""
    tasks = db.query(Task).filter(Task.id.in_(task_ids), Task.user_id == current_user.id).all()
    group_ids = set()
    remove_tasks_outputs(tasks)
    _unbind_api_call_logs(db, task_ids=[t.id for t in tasks])
    count = 0
    for task in tasks:
        group_ids.add(task.group_id)
        db.delete(task)
        count += 1

    db.commit()

    # 清理变空的组（顺手把 ApiCallLog.group_id 也解绑）
    emptied = []
    for g_id in group_ids:
        remaining = db.query(Task).filter(Task.group_id == g_id).count()
        if remaining == 0:
            group = db.query(TaskGroup).filter(TaskGroup.id == g_id).first()
            if group:
                emptied.append(g_id)
                db.delete(group)
    if emptied:
        _unbind_api_call_logs(db, group_ids=emptied)
    db.commit()
    return {"message": f"Successfully deleted {count} tasks"}

@router.get("/fission/{group_id}/chain", response_model=List[TaskGroupResponse])
def get_fission_chain(
    group_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """查询一个裂变任务的全生命周期血缘链（自动溯源到根节点，并拉取所有衍生批次）"""
    # 1. 查找当前触发节点
    current = db.query(TaskGroup).filter(TaskGroup.id == group_id, TaskGroup.user_id == current_user.id).first()
    if not current:
        raise HTTPException(status_code=404, detail="Fission group not found")
    
    # 2. 向上溯源寻找真正的 Root (祖先节点)
    root = current
    while root.fission_parent_id:
        parent = db.query(TaskGroup).filter(TaskGroup.id == root.fission_parent_id).first()
        if not parent: break # 容错：父节点可能被物理删除
        root = parent
        
    # 3. 递归（或两层平铺）查找该 Root 下的所有子孙
    # 目前我们的 Fission 系统中，衍生关系主要由 Root 发起（Images -> Videos, Images -> Extends）
    # 为兼容未来多级延展，我们搜索所有以该 Root ID 作为祖先标识或直接 Parent 的组
    # 目前简化实现：拉取 Root，以及所有直接以 Root 为 parent 的 Children
    all_related = [root]
    
    # 深度优先或广度优先查找所有后代 (由于目前层级较浅，直接查找所有 fission_parent_id 链条)
    # 简单策略：查找所有 parent 为 root.id 的，以及 parent 为这些 children 的...
    children = db.query(TaskGroup).options(joinedload(TaskGroup.tasks))\
        .filter(TaskGroup.fission_parent_id == root.id).all()
    
    # 针对每一层 child，再看是否有下一层 (如：视频延展)
    all_related.extend(children)
    for child in children:
        grand_children = db.query(TaskGroup).options(joinedload(TaskGroup.tasks))\
            .filter(TaskGroup.fission_parent_id == child.id).all()
        all_related.extend(grand_children)
        
    # 最后统一加载 Root 的 tasks (如果 root 还没加载的话)
    if not root.tasks:
        db.refresh(root)
        
    # 按创建时间排序返回
    all_related.sort(key=lambda x: x.created_at)
    return all_related


