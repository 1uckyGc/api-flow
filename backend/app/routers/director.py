from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.orm import Session
import uuid

from app.database import get_db
from app.models.user import User
from app.models.task import Task, TaskGroup, TaskType, TaskSource, TaskStatus, GroupStatus
from app.schemas.task import TaskGroupResponse, DirectorCreateRequest, DirectorConfirmRequest, DirectorVideoRequest
from app.routers.auth import get_current_user
from app.workers.director_worker import execute_director_session

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/director", tags=["director"])

@router.post("/create", response_model=TaskGroupResponse)
async def create_director_session(
    req: DirectorCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    导演模式：剧本 → n 张连贯分镜图。
    立即返回 TaskGroup（含 n 个 QUEUED 子任务），后台异步执行三阶段生成。
    """
    if not req.product_files:
        raise HTTPException(status_code=400, detail="至少需要上传一张产品白底图")
    if not req.script.strip():
        raise HTTPException(status_code=400, detail="剧本内容不能为空")

    group = TaskGroup(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=req.title,
        task_type=TaskType.IMAGE_TO_IMAGE,
        source=TaskSource.DIRECTOR,
        global_prompt=req.script[:500],
        config_json={
            "model": req.model,
            "videoModel": req.video_model,
            "product_files": req.product_files,
            "script": req.script,
            "count": req.count,
            "style": req.style or "",
            "character_desc": req.character_desc or "",
        },
        total_count=req.count,
        status=GroupStatus.PENDING,
    )
    db.add(group)
    db.commit()
    db.refresh(group)

    # 预建 n 个 placeholder Task（状态 QUEUED，供前端立即渲染骨架）
    db_tasks = []
    for i in range(req.count):
        task = Task(
            id=str(uuid.uuid4()),
            group_id=group.id,
            user_id=current_user.id,
            prompt=f"[分镜 {i + 1}] 等待导演引擎分配...",
            input_files=req.product_files,
            config_json={"index": i + 1},  # 明确存储序号，确保生成顺序不乱
            status=TaskStatus.QUEUED,
        )
        db_tasks.append(task)
        db.add(task)
    db.commit()
    db.refresh(group)

    from app.workers.director_worker import run_director_session
    run_director_session.delay(
        group.id,
        group.config_json,
        current_user.id,
    )

    return group


@router.post("/{group_id}/confirm-scenes", response_model=TaskGroupResponse)
async def confirm_director_scenes(
    group_id: str,
    req: DirectorConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(TaskGroup).filter(TaskGroup.id == group_id, TaskGroup.user_id == current_user.id).first()
    if not group:
        raise HTTPException(status_code=404, detail="任务组不存在")
    if group.status != GroupStatus.NEEDS_REVIEW:
        raise HTTPException(status_code=400, detail="任务组当前不在等待确认状态")

    # Save the updated scenes
    new_cfg = dict(group.config_json or {})
    new_cfg["director_scenes"] = req.director_scenes
    group.config_json = new_cfg
    group.status = GroupStatus.PROCESSING
    db.commit()
    db.refresh(group)

    from app.workers.director_worker import run_director_session
    run_director_session.delay(
        group.id,
        group.config_json,
        current_user.id,
    )
    return group


@router.post("/{group_id}/retry", response_model=TaskGroupResponse)
async def retry_director_session(
    group_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    当锚点图或者后续分镜生成失败时，原位重试（跳过选定剧本阶段，直接进入 Phase 2）
    """
    group = db.query(TaskGroup).filter(TaskGroup.id == group_id, TaskGroup.user_id == current_user.id).first()
    if not group:
        raise HTTPException(status_code=404, detail="任务组不存在")
    if group.status in [GroupStatus.PENDING, GroupStatus.PROCESSING]:
        raise HTTPException(status_code=400, detail="任务流正在执行中，无法重置与重试")
    if not group.config_json or not group.config_json.get("director_scenes"):
        raise HTTPException(status_code=400, detail="缺乏剧本分镜数据，请重新创建任务")

    # Reset all failed tasks in this group
    tasks = db.query(Task).filter(Task.group_id == group_id).all()
    for t in tasks:
        if t.status == TaskStatus.FAILED:
            t.status = TaskStatus.QUEUED
            t.error_message = None

    group.status = GroupStatus.PROCESSING
    group.progress_message = "重新启动生成流程..."
    db.commit()
    db.refresh(group)

    from app.workers.director_worker import run_director_session
    run_director_session.delay(
        group.id,
        group.config_json,
        current_user.id,
    )
    return group

@router.post("/{group_id}/generate-videos", response_model=TaskGroupResponse)
async def generate_video_sequence(
    group_id: str,
    req: DirectorVideoRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    导演模式 Phase 2：将分镜图批量转为视频序列。
    创建一个子 TaskGroup（source=DIRECTOR_VIDEO，fission_parent_id=image group），
    为每张成功的分镜图创建一个 I2V Task，并立即调度 Celery 任务处理。
    """
    image_group = db.query(TaskGroup).filter(
        TaskGroup.id == group_id,
        TaskGroup.user_id == current_user.id,
    ).first()
    if not image_group:
        raise HTTPException(status_code=404, detail="找不到指定的分镜图任务组")
    if image_group.source != TaskSource.DIRECTOR:
        raise HTTPException(status_code=400, detail="目标任务组不是导演模式图像组")

    # 获取成功的图 Tasks，按 index 排序
    raw_image_tasks = db.query(Task).filter(
        Task.group_id == group_id,
        Task.status == TaskStatus.SUCCESS,
    ).all()

    if req.task_ids:
        raw_image_tasks = [t for t in raw_image_tasks if t.id in req.task_ids]

    image_tasks = sorted(raw_image_tasks, key=lambda x: (x.config_json.get("index") or 0, x.created_at))

    if not image_tasks:
        raise HTTPException(status_code=400, detail="没有可生成视频的成功分镜图（所有帧均需处于 success 状态）")

    # 从父组读取分镜场景描述
    scenes: list[dict] = image_group.config_json.get("director_scenes", [])

    # 创建视频子 TaskGroup
    video_group = TaskGroup(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=f"{image_group.title} · 视频序列",
        task_type=TaskType.IMAGE_TO_VIDEO,
        source=TaskSource.DIRECTOR_VIDEO,
        fission_parent_id=group_id,
        fission_stage="videos",
        global_prompt=image_group.global_prompt,
        config_json={
            "model": req.video_model,
            "parent_group_id": group_id,
            "director_scenes": scenes,
        },
        total_count=len(image_tasks),
        status=GroupStatus.PENDING,
    )
    db.add(video_group)
    db.commit()
    db.refresh(video_group)

    from app.prompts import DIRECTOR_I2V_PROMPT
    from app.workers.tasks import process_generation

    # 为每张图创建对应的视频 Task 并调度
    for idx, img_task in enumerate(image_tasks):
        img_index = img_task.config_json.get("index", idx + 1) - 1  # 0-based
        scene = scenes[img_index] if img_index < len(scenes) else {}

        # 核心功能：运用用户运镜和自定义覆盖
        action_text = scene.get("action", "natural movement")
        custom_action = (req.video_prompts or {}).get(img_task.id)
        if custom_action and custom_action.strip():
            action_text = f"{custom_action} (Base style context: {action_text})"

        video_prompt = DIRECTOR_I2V_PROMPT.format(
            shot_type=scene.get("shot_type", "medium shot"),
            action=action_text,
            description=scene.get("description", ""),
        )
        scene_title = scene.get("title", f"分镜 {idx + 1}")

        video_task = Task(
            id=str(uuid.uuid4()),
            group_id=video_group.id,
            user_id=current_user.id,
            prompt=f"[TITLE] {scene_title} [/TITLE]\n{video_prompt}",
            input_files=[img_task.output_file] if img_task.output_file else [],
            config_json={
                "index": idx + 1,
                "source_image_task_id": img_task.id,
                "model": req.video_model,
            },
            status=TaskStatus.QUEUED,
        )
        db.add(video_task)
        db.commit()

        process_generation.delay(video_task.id)

    db.refresh(video_group)
    return video_group
