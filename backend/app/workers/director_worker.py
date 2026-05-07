import asyncio
import os
import random
import uuid
import logging

from app.database import SessionLocal
from app.models.task import Task, TaskGroup, TaskStatus, GroupStatus
from app.models.settings import SystemSettings
from app.services.ai_service import ai_client, generate_director_scene_prompts
from app.services.dispatcher import dispatch_generate
from app.workers.celery_app import celery_app
from app.workers.tasks import notify_ws, update_group_status
from app.utils.logger import logger


def _get_user_api_key(db, user_id: int, model: str) -> str | None:
    user_settings = db.query(SystemSettings).filter(SystemSettings.user_id == user_id).first()
    if not user_settings:
        return None
    if "veo" in model.lower():
        return user_settings.veo_api_key
    if "gemini" in model.lower():
        return user_settings.gemini_api_key
    return None


def _save_result_to_task(db, task: Task, result, group_id: str):
    """将生成结果写入 Task 并持久化；成功/失败均调用 update_group_status"""
    if result.success and result.data:
        filename = f"{uuid.uuid4().hex}{result.file_ext}"
        filepath = os.path.join("outputs", filename)
        with open(filepath, "wb") as f:
            f.write(result.data)
        task.output_file = filepath
        task.status = TaskStatus.SUCCESS
        logger.info(f"Director task {task.id} saved → {filepath}")
    else:
        task.status = TaskStatus.FAILED
        task.error_message = result.error
        logger.error(f"Director task {task.id} failed: {result.error}")
    db.commit()
    update_group_status(db, group_id)


# ---------------------------------------------------------------------------
# 导演模式 Session
# ---------------------------------------------------------------------------

async def execute_director_session(group_id: str, payload: dict, user_id: int):
    """
    三阶段执行：
      Phase 1  — LLM 解析剧本 → n 个分镜描述
      Phase 2  — 串行生成锚点图（第 1 帧），结果写入 config_json["anchor_file"]
      Phase 3  — 并行生成剩余 n-1 帧（由 AIClient 全局限流器控制排队）
    """
    db = SessionLocal()
    try:
        group = db.query(TaskGroup).filter(TaskGroup.id == group_id).first()
        if not group:
            return

        # 核心修复：显式物理定序。
        # 由于分镜任务通常在同一个事务中批量创建，created_at 相同，导致默认查询顺序随机。
        # 优先使用 config_json['index']，回退到 created_at 和 id 组合确保绝对稳定。
        raw_tasks = db.query(Task).filter(Task.group_id == group_id).all()
        tasks = sorted(raw_tasks, key=lambda x: (x.config_json.get("index") or 0, x.created_at, x.id))

        async def push_progress(msg: str):
            group.progress_message = msg
            db.commit()
            await notify_ws(user_id, {"type": "GROUP_PROGRESS", "group_id": group_id, "message": msg})

        model = payload.get("model", "gemini-3.1-flash-image-portrait")
        product_files = payload.get("product_files", [])
        script = payload.get("script", "")
        count = payload.get("count", len(tasks))
        style = payload.get("style", "")
        character_desc = payload.get("character_desc", "")

        api_key = _get_user_api_key(db, user_id, model)

        # ── 状态分流机制：自动挂起与断点唤醒 ──────────────────────────────
        scenes = payload.get("director_scenes", [])
        
        if group.status == GroupStatus.PENDING:
            # ── Phase 1：剧本大模型解析 ────────────────────────────────────
            try:
                scenes = await generate_director_scene_prompts(
                    script=script,
                    count=count,
                    style=style,
                    character_desc=character_desc,
                    product_image_paths=product_files,
                    progress_callback=push_progress,
                )
            except Exception as e:
                logger.error(f"Director Phase 1 failed for group {group_id}: {e}")
                group.status = GroupStatus.FAILED
                group.progress_message = f"剧本解析失败: {e}"
                db.commit()
                await notify_ws(user_id, {"type": "TASK_UPDATE"})
                return
            
            # 核心机制：存入剧本后修改为待查并挂起（退出当前异步协程）
            new_cfg = dict(group.config_json or {})
            new_cfg["director_scenes"] = scenes
            group.config_json = new_cfg
            group.status = GroupStatus.NEEDS_REVIEW
            group.progress_message = "剧本解析完成，等待人工核查..."
            db.commit()
            
            # 敲击 WebSocket 让前端弹出核查面板
            await notify_ws(user_id, {"type": "TASK_UPDATE"})
            return

        elif group.status == GroupStatus.PROCESSING:
            # ── 被 confirm-scenes 新 API 直接召唤（状态已经是 PROCESSING）──
            if not scenes:
                logger.error(f"Phase 2 starts but missing director_scenes in config for {group_id}")
                return
            
        else:
            logger.warning(f"Worker skipped execution due to unknown status {group.status}")
            return

        # 帧数对齐
        scene_count = min(len(scenes), len(tasks))

        # ── Phase 2：生成锚点图（第 1 帧，串行阻塞）────────────────────────
        anchor_task = tasks[0]
        
        if anchor_task.status == TaskStatus.SUCCESS and group.config_json.get("anchor_file"):
            anchor_file = group.config_json.get("anchor_file")
            await push_progress("锚点基准图已就绪，跳过生成...")
        else:
            anchor_task.status = TaskStatus.RUNNING
            db.commit()
            await notify_ws(user_id, {"type": "TASK_UPDATE"})
            await push_progress("正在生成锚点基准图（第 1 帧）...")

            from app.prompts import DIRECTOR_ANCHOR_VISION_PROMPT
            anchor_prompt_str = (
                f"{DIRECTOR_ANCHOR_VISION_PROMPT}\n\n"
                f"分镜描述：{scenes[0].get('description', '')}\n"
                f"景别：{scenes[0].get('shot_type', '')}，动作：{scenes[0].get('action', '')}"
            )
            
            anchor_title = scenes[0].get('title', '锚点大纲')
            anchor_task.prompt = f"[TITLE] {anchor_title} [/TITLE]\n{anchor_prompt_str}"
            anchor_task.input_files = product_files if product_files else []
            db.commit()

            anchor_result = await dispatch_generate(
                model=model,
                prompt=anchor_task.prompt,
                image_paths=anchor_task.input_files or None,
                config_json=group.config_json,
                api_key=api_key,
                max_retries=3,
                user_id=user_id,
                task_id=anchor_task.id,
                group_id=group_id,
            )

            db.refresh(anchor_task)
            _save_result_to_task(db, anchor_task, anchor_result, group_id)

            if not anchor_result.success:
                group.status = GroupStatus.FAILED
                group.progress_message = f"锚点图生成失败: {anchor_result.error}"
                for i in range(1, len(tasks)):
                    tasks[i].status = TaskStatus.FAILED
                    tasks[i].error_message = f"由于锚点帧(第1帧)生成失败，后续流程已取消。请使用左侧全组重试功能。"
                db.commit()
                update_group_status(db, group_id)
                await notify_ws(user_id, {"type": "TASK_UPDATE"})
                return

            anchor_file = anchor_task.output_file
        new_cfg = dict(group.config_json or {})
        new_cfg["anchor_file"] = anchor_file
        group.config_json = new_cfg
        db.commit()
        await notify_ws(user_id, {"type": "TASK_UPDATE"})
        await push_progress(f"锚点图就绪，开始并行生成剩余 {scene_count - 1} 帧...")

        # ── Phase 3：并行生成剩余帧 ───────────────────────────────────────
        async def _generate_frame(idx: int):
            frame_db = SessionLocal()
            try:
                frame_task = frame_db.query(Task).filter(Task.id == tasks[idx].id).first()
                if not frame_task:
                    return
                frame_task.status = TaskStatus.RUNNING
                frame_db.commit()
                await notify_ws(user_id, {"type": "TASK_UPDATE"})

                from app.prompts import DIRECTOR_LOOP_ANCHOR_PROMPT, DIRECTOR_LOOP_PRODUCT_PROMPT
                frame_prompt_str = (
                    f"{DIRECTOR_LOOP_ANCHOR_PROMPT}\n\n"
                    f"{DIRECTOR_LOOP_PRODUCT_PROMPT}\n\n"
                    f"当前分镜描述：{scenes[idx].get('description', '')}\n"
                    f"景别：{scenes[idx].get('shot_type', '')}，动作：{scenes[idx].get('action', '')}"
                )

                # 限制为仅传单张锚点图，否则会报 PUBLIC_ERROR_MINOR_UPLOAD (Invalid argument)
                ref_images = [anchor_file] if anchor_file else []
                frame_title = scenes[idx].get('title', f'分镜 {idx+1}')
                frame_task.prompt = f"[TITLE] {frame_title} [/TITLE]\n{frame_prompt_str}"
                frame_task.input_files = ref_images
                frame_db.commit()

                result = await dispatch_generate(
                    model=model,
                    prompt=frame_task.prompt,
                    image_paths=frame_task.input_files or None,
                    config_json=group.config_json,
                    api_key=api_key,
                    max_retries=3,
                    user_id=user_id,
                    task_id=frame_task.id,
                    group_id=group_id,
                )

                frame_db.refresh(frame_task)
                _save_result_to_task(frame_db, frame_task, result, group_id)
                await notify_ws(user_id, {"type": "TASK_UPDATE"})
            except Exception as e:
                logger.error(f"Director frame {idx} failed: {e}")
                ft = frame_db.query(Task).filter(Task.id == tasks[idx].id).first()
                if ft:
                    ft.status = TaskStatus.FAILED
                    ft.error_message = str(e)
                    frame_db.commit()
                    update_group_status(frame_db, group_id)
                await notify_ws(user_id, {"type": "TASK_UPDATE"})
            finally:
                frame_db.close()

        if scene_count > 1:
            await asyncio.gather(*[_generate_frame(i) for i in range(1, scene_count)])

        await push_progress("导演模式生成完毕！")
        await notify_ws(user_id, {"type": "TASK_UPDATE"})

    except Exception as e:
        logger.error(f"execute_director_session failed for {group_id}: {e}")
        db.rollback()
        grp = db.query(TaskGroup).filter(TaskGroup.id == group_id).first()
        if grp:
            grp.status = GroupStatus.FAILED
            grp.progress_message = str(e)
            try:
                db.commit()
            except Exception:
                db.rollback()
        await notify_ws(user_id, {"type": "TASK_UPDATE"})
    finally:
        db.close()

# ── Celery Task Wrappers ──────────────────────────────────────────────────

@celery_app.task(bind=True, name="app.workers.director_worker.run_director_session")
def run_director_session(self, group_id: str, payload: dict, user_id: int):
    """导演模式生产线入口"""
    import asyncio
    asyncio.run(execute_director_session(group_id, payload, user_id))

