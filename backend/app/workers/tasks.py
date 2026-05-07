import asyncio
import os
import uuid
import logging
import subprocess
import tempfile
from datetime import datetime
import httpx

from app.workers.celery_app import celery_app
from app.database import SessionLocal
from app.models.task import Task, TaskGroup, TaskStatus, GroupStatus
from app.models.settings import SystemSettings
from app.services.ai_service import ai_client
from app.services.grok_client import grok_client

import traceback
from app.utils.logger import logger

def trim_video_tail(input_path: str, tail_frames: int = 9) -> bool:
    """自动探明视频最终帧数，砍掉末尾劣化帧以避免 VEO 模型固定顽症"""
    if tail_frames <= 0 or not input_path.endswith('.mp4'):
        return True
    try:
        # 获取视频的帧率和总帧数
        cmd_fps = [
            'ffprobe', '-v', 'error', '-select_streams', 'v:0', 
            '-show_entries', 'stream=r_frame_rate,nb_frames', 
            '-of', 'default=noprint_wrappers=1:nokey=1', input_path
        ]
        output = subprocess.check_output(cmd_fps, stderr=subprocess.STDOUT).decode('utf-8').strip().split('\n')
        if len(output) < 2: 
            return False
            
        total_frames = int(output[1])
        if total_frames <= tail_frames:
            return False
            
        target_frames = total_frames - tail_frames
        logger.info(f"Video {input_path} has {total_frames} frames. Trimming down to {target_frames} frames.")
        
        tmp_path = input_path + ".tmp.mp4"
        # 直接使用精确截取重编码或者复制流的方式（如果遇到非关键帧复制会出问题，默认保守转码 libx264 以确保帧级别精确，且规避VEO时间戳毛刺）
        cmd_trim = ['ffmpeg', '-y', '-i', input_path, '-frames:v', str(target_frames), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', tmp_path]
        subprocess.check_call(cmd_trim, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.replace(tmp_path, input_path)
        return True
    except Exception as e:
        logger.error(f"Failed to trim video tail for {input_path}: {e}")
        return False

def extract_video_poster(video_path: str) -> str | None:
    """使用 FFmpeg 提取视频 0.1s 处的首帧作为封面图 (Iter 4)"""
    if not video_path or not os.path.exists(video_path):
        return None
    
    poster_path = f"{video_path}.poster.jpg"
    try:
        # -ss 0.1 跳过可能存在的纯黑开局
        # -vframes 1 只截一帧
        # -q:v 2 保持高质量 (JPG 质量 2 约为最高)
        cmd = [
            "ffmpeg", "-y",
            "-ss", "0.1",
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",
            poster_path
        ]
        import subprocess
        subprocess.run(cmd, check=True, capture_output=True)
        # 返回相对路径
        return poster_path.replace("\\", "/")
    except Exception as e:
        logger.error(f"提取视频封面失败: {e}")
        return None

def extract_last_video_frame(video_path: str) -> str | None:
    """提取视频最后一帧作为 Grok 延长时的 I2V 参考图"""
    if not video_path or not os.path.exists(video_path):
        return None
    
    out_path = f"{video_path}.lastframe.jpg"
    try:
        # -sseof -0.1 找最后0.1秒附近，-update 1复写确保拿到最后一帧
        cmd = [
            "ffmpeg", "-y",
            "-sseof", "-0.1",
            "-i", video_path,
            "-update", "1",
            "-q:v", "2",
            out_path
        ]
        import subprocess
        subprocess.run(cmd, check=True, capture_output=True)
        return out_path
    except Exception as e:
        logger.error(f"提取视频尾帧失败: {e}")
        return None

def skip_initial_frames(input_path: str, count: int = 1) -> bool:
    """跳过视频开头的指定帧数，解决延长拼接时的重复顿挫感"""
    if not input_path.endswith('.mp4') or count <= 0:
        return True
    try:
        tmp_path = input_path + ".nohead.mp4"
        # 使用 select='gte(n,count)' 跳过前 count 帧
        cmd = ['ffmpeg', '-y', '-i', input_path, '-vf', f"select='gte(n,{count})'", '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', tmp_path]
        subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.replace(tmp_path, input_path)
        logger.info(f"Successfully skipped first {count} frames of {input_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to skip first {count} frames for {input_path}: {e}")
        return False

def concatenate_videos(video_list: list, output_path: str) -> bool:
    """使用 FFmpeg concat 协议拼接视频"""
    if not video_list: return False
    try:
        # 创建临时映射文件
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            for v in video_list:
                # 必须是绝对路径且转义
                abs_v = os.path.abspath(v).replace('\\', '/')
                f.write(f"file '{abs_v}'\n")
            list_path = f.name
            
        cmd = [
            'ffmpeg', '-y', '-f', 'concat', '-safe', '0', 
            '-i', list_path, '-c', 'copy', output_path
        ]
        subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(list_path):
            os.remove(list_path)
        return True
    except Exception as e:
        logger.error(f"Concatenation failed: {e}")
        return False

def update_group_status(db, group_id: str):
    """基于数据库聚合原子更新任务组状态，避免并发竞态"""
    from sqlalchemy import func, case
    
    # 单条聚合查询，不依赖 Python 内存中的 task 列表
    counts = db.query(
        func.count().label("total"),
        func.count(case((Task.status == TaskStatus.SUCCESS, 1))).label("completed"),
        func.count(case((Task.status == TaskStatus.FAILED, 1))).label("failed"),
        func.count(case((Task.status == TaskStatus.RUNNING, 1))).label("running"),
    ).filter(Task.group_id == group_id).first()
    
    if not counts or counts.total == 0:
        return
    
    group = db.query(TaskGroup).filter(TaskGroup.id == group_id).first()
    if not group:
        return
    
    group.completed_count = counts.completed
    group.failed_count = counts.failed
    
    if counts.completed + counts.failed >= group.total_count:
        if counts.failed == group.total_count and counts.total > 0:
            group.status = GroupStatus.FAILED
        else:
            # 增加 PIPELINE 来源映射
            group.status = GroupStatus.NEEDS_REVIEW if group.source in ["pipeline", "FISSION", "PIPELINE"] else GroupStatus.COMPLETED
    elif counts.running > 0:
        group.status = GroupStatus.PROCESSING
        
    db.commit()

    # [新增] 工作流自动推进钩子
    if group.workflow_run_id and group.status in (GroupStatus.COMPLETED, GroupStatus.NEEDS_REVIEW):
        from app.models.workflow import WorkflowRun
        from app.workers.workflow_worker import advance_workflow
        
        # 收集该生成步骤中所有的成功产物返回
        success_tasks = db.query(Task).filter(Task.group_id == group_id, Task.status == TaskStatus.SUCCESS).all()
        
        run = db.query(WorkflowRun).filter(WorkflowRun.id == group.workflow_run_id).first()
        if run and run.current_step == group.workflow_step_index:
            steps_state = list(run.steps_state)
            current_state = steps_state[run.current_step]
            
            # 状态标志进入已完成，填充该步的文件产出
            current_state["status"] = "completed"
            current_state["output_files"] = [t.output_file for t in success_tasks if t.output_file]
            
            run.steps_state = steps_state
            db.commit()
            
            # 推入 Celery 执行下一步
            advance_workflow.delay(run.id, run.current_step + 1)

async def notify_ws(user_id: int, message: dict, client: httpx.AsyncClient = None):
    try:
        api_url = os.environ.get("WEB_API_URL", "http://backend:8000")
        if client:
            await client.post(f"{api_url}/ws/internal/notify", json={"user_id": user_id, "message": message})
        else:
            async with httpx.AsyncClient() as c:
                await c.post(f"{api_url}/ws/internal/notify", json={"user_id": user_id, "message": message})
    except Exception as e:
        logger.warning(f"Failed to notify WS: {e}")

async def execute_generation_task(task_id: str):
    db = SessionLocal()
    async with httpx.AsyncClient(timeout=10) as ws_client:
      try:
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            logger.error(f"Task {task_id} not found")
            return

        group = db.query(TaskGroup).filter(TaskGroup.id == task.group_id).first()
        user_id = group.user_id if group else 1

        async def on_progress(msg: str):
            await notify_ws(user_id, {
                "type": "TASK_PROGRESS",
                "task_id": task_id,
                "message": msg
            }, client=ws_client)

        # 更新状态为运行中
        task.status = TaskStatus.RUNNING
        db.commit()
        update_group_status(db, task.group_id)
        
        # 通知画廊可以移除空状态了
        await notify_ws(user_id, {"type": "TASK_UPDATE"}, client=ws_client)
        
        # 准备参数
        group = task.group
        model = group.config_json.get("model", "veo_3_1_t2v_portrait")
        prompt = task.prompt or group.global_prompt or ""
        
        # 拦截未被 DirectorWorker 初始化的挂起分镜被手动重试
        if "等待导演引擎分配" in prompt:
            task.status = TaskStatus.FAILED
            task.error_message = "该分镜缺乏锚点图前提数据，请使用左侧列表的「重试断点执行」进行全组重发。"
            db.commit()
            update_group_status(db, task.group_id)
            await notify_ws(user_id, {"type": "TASK_UPDATE"}, client=ws_client)
            return


        # 读取系统设置 (动态并发参数、密钥注入、去尾帧数等)
        user_settings = db.query(SystemSettings).filter(SystemSettings.user_id == user_id).first()
        
        delay_ms = user_settings.submission_delay_ms if user_settings else 2000
        max_retries = user_settings.max_retries if user_settings else task.max_retries
        allow_fallback = user_settings.allow_fallback_model if user_settings else True
        trim_frames = user_settings.trim_tail_frames if user_settings else 9
        
        api_key = None
        if user_settings:
            if "veo" in model.lower():
                api_key = user_settings.veo_api_key
            elif "gemini" in model.lower():
                api_key = user_settings.gemini_api_key

        if delay_ms > 0:
            logger.info(f"Task {task_id} waiting for {delay_ms}ms buffer based on settings")
            await asyncio.sleep(delay_ms / 1000.0)

        # 调用 AI API
        logger.info(f"Task {task_id} starting AI generation with model {model}")
        is_grok = model.startswith("grok-")
        if is_grok:
            # Grok 专属路径：走 grok_client，包一层强制重试
            actual_retries = max_retries if max_retries > 0 else 3
            last_err = ""
            for attempt in range(actual_retries + 1):
                if attempt > 0 and on_progress:
                    await on_progress(f"[重试 {attempt}/{actual_retries}] 正在重新排队提交...")
                    
                input_files = task.input_files or []
                
                # --- 核心拦截：如果 Grok 做的是视频延展，说明 input_files[0] 是 mp4 ---
                img_path_for_grok = input_files[0] if input_files else None
                if group.config_json.get("isExtension") and img_path_for_grok and img_path_for_grok.endswith(".mp4"):
                    if on_progress:
                        await on_progress("正在提取视频尾帧作为环境参考...")
                    last_frame_path = extract_last_video_frame(img_path_for_grok)
                    if last_frame_path:
                        img_path_for_grok = last_frame_path
                
                try:
                    result = await grok_client.generate(
                        model=model,
                        prompt=prompt,
                        config_json=group.config_json,
                        input_image_path=img_path_for_grok,
                        input_image_paths=[img_path_for_grok] if img_path_for_grok else None,
                        api_key=api_key,
                        progress_callback=on_progress,
                    )
                    
                    if result.success:
                        break
                    else:
                        last_err = str(result.error)
                        logger.warning(f"Grok retry loop attempt {attempt+1} failed: {last_err}")
                except Exception as e:
                    last_err = str(e)
                    logger.warning(f"Grok retry loop attempt {attempt+1} raised: {last_err}")

                # 清理为了 grok 延展而生成的临时尾帧图
                if group.config_json.get("isExtension") and img_path_for_grok and img_path_for_grok.endswith(".lastframe.jpg"):
                    try:
                        os.remove(img_path_for_grok)
                    except Exception:
                        pass
                
                if attempt < actual_retries:
                    await asyncio.sleep(2 ** attempt)
            
            if not result or not result.success:
                result.error = f"Max retries ({actual_retries}) reached. Last error: {last_err}"
        else:
            result = await ai_client.generate_with_retry(
                model=model,
                prompt=prompt,
                image_paths=task.input_files if task.input_files else None,
                max_retries=max_retries,
                progress_callback=on_progress,
                api_key=api_key,
                allow_fallback=allow_fallback
            )

        if result.success and result.data:
            # 保存文件
            filename = f"{uuid.uuid4().hex}{result.file_ext}"
            filepath = os.path.join("outputs", filename)
            with open(filepath, "wb") as f:
                f.write(result.data)
                
            task.output_file = filepath
            
            # --- 全局视频尾部劣化切除逻辑 (强关联 veo 和 mp4 产物) ---
            if "veo" in model.lower() and filepath.endswith(".mp4") and trim_frames > 0:
                if on_progress:
                    await on_progress(f"提取优化中 (切除尾部 {trim_frames} 帧无用画面)...")
                success = trim_video_tail(filepath, trim_frames)
                if success:
                    logger.info(f"Task {task_id} successfully trimmed tail frames.")
            
            # --- 全局延展视频首尾拼接逻辑 ---
            if group.config_json.get("isExtension") and task.input_files:
                prev_video = task.input_files[0]
                if prev_video.endswith(".mp4") and os.path.exists(prev_video):
                    if on_progress:
                        await on_progress("正在优化衔接点 (拼接画面)...")
                    
                    if not is_grok:
                        # 仅 Veo 模型存在显著的首帧重复问题，因此切割
                        skip_initial_frames(filepath, count=2)

                    if on_progress:
                        await on_progress("正在将两段视频首尾缝合...")
                    
                    merged_filename = f"merged_{filename}"
                    merged_path = os.path.join("outputs", merged_filename)
                    if concatenate_videos([prev_video, filepath], merged_path):
                        os.replace(merged_path, filepath)
                        logger.info(f"Task {task_id} successfully merged with parent: {prev_video}")
                    else:
                        logger.error(f"Task {task_id} merge failed.")
                    
            task.status = TaskStatus.SUCCESS
            logger.info(f"Task {task_id} generated successfully: {filepath}")
            
            # 迭代 4：自动生成视频封面 (Poster)
            if filepath.lower().endswith(('.mp4', '.webm', '.mov')):
                poster_path = extract_video_poster(filepath)
                if poster_path:
                    # 获取相对 outputs 的路径
                    if poster_path.startswith("outputs/"):
                        task.output_thumbnail = poster_path
                    else:
                        task.output_thumbnail = os.path.join("outputs", os.path.basename(poster_path)).replace("\\", "/")
                    logger.info(f"Video poster generated: {task.output_thumbnail}")
        else:
            task.status = TaskStatus.FAILED
            task.error_message = result.error
            logger.error(f"Task {task_id} failed: {result.error}")

        task.updated_at = datetime.utcnow()
        db.commit()
        update_group_status(db, task.group_id)
        
        await notify_ws(user_id, {"type": "TASK_UPDATE"}, client=ws_client)
        
      except Exception:
        # 迭代 3：捕获完整堆栈，以便彻底排查 "Event loop is closed" 到底发生在哪个库
        err_stack = traceback.format_exc()
        logger.error(f"Unhandled error in execute_generation_task {task_id}:\n{err_stack}")
        
        db.rollback()
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            task.status = TaskStatus.FAILED
            # 将堆栈末尾的核心错误记录到数据库，完整堆栈保留在 logs/app.log
            task.error_message = f"Internal Error: {err_stack.splitlines()[-1]}"
            try:
                db.commit()
            except Exception:
                db.rollback()
            try:
                update_group_status(db, task.group_id)
            except Exception as outer_e:
                logger.error(f"Failed to update group status during exception handler: {outer_e}")
            
            group = db.query(TaskGroup).filter(TaskGroup.id == task.group_id).first()
            user_id = group.user_id if group else 1
            await notify_ws(user_id, {"type": "TASK_UPDATE"}, client=ws_client)
      finally:
        db.close()

@celery_app.task(bind=True, name="app.workers.tasks.process_generation")
def process_generation(self, task_id: str):
    """Celery worker 入口函数 —— 迭代 3：解决 Loop 漂移的核心加固"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop_id = id(loop)
    logger.info(f"Task {task_id} starting in PID {os.getpid()} with Loop {loop_id}")
    try:
        loop.run_until_complete(execute_generation_task(task_id))
    finally:
        logger.info(f"Task {task_id} cleaning up loop {loop_id}")
        loop.close()
