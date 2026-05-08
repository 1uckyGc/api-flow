"""复刻视频（storyboard 9宫格分镜复刻）路由。

工作流：
1. POST /api/replicate/jobs   ← 上传样片+商品图+品牌表单 → 渲染 master_prompt → 等用户拿去 LLM 网页跑
2. POST /api/replicate/jobs/{id}/llm-output ← 用户把 LLM 完整输出粘回来 → 自动拆 GU
3. GET  /api/replicate/jobs/{id}/gus        ← 列出 N 个 GU（含 A/B 双产线提示词）
4. POST /api/replicate/jobs/{id}/gus/{gu_id}/generate-image  ← Phase 3：一键调 HOLO 出 9宫格图
5. POST /api/replicate/jobs/{id}/gus/{gu_id}/generate-video  ← Phase 3：一键调 HOLO 出 15秒视频
"""
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.task import Task, TaskGroup, TaskType, TaskSource, TaskStatus, GroupStatus
from app.routers.auth import get_current_user
from app.services.storyboard.pipeline import (
    build_brand_config_block,
    parse_llm_output,
    render_master_prompt,
    save_gus_to_dir,
)
from app.utils.logger import logger

router = APIRouter(prefix="/api/replicate", tags=["replicate"])


# ─────────────────────────────────────────────────────────────────────
# 目录约定
# ─────────────────────────────────────────────────────────────────────
UPLOAD_BASE = Path("uploads")
REPLICATE_BASE = UPLOAD_BASE / "replicate"   # 跟普通 uploads/ 区分，便于 cleanup_tasks 清理


def _job_dir(job_id: str) -> Path:
    d = REPLICATE_BASE / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _save_upload_to(file: UploadFile, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    return dest


# ─────────────────────────────────────────────────────────────────────
# 1. 创建作业
# ─────────────────────────────────────────────────────────────────────
@router.post("/jobs")
async def create_job(
    title: str = Form(...),
    brand: str = Form("{}"),                    # JSON 字符串
    auto_mode: bool = Form(False),              # 勾选后自动调 Gemini 跑 LLM
    gemini_model: str = Form(""),               # auto_mode 时使用，留空用默认
    sample_video: UploadFile = File(...),
    product_images: List[UploadFile] = File(default=[]),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """接受样片视频 + N 张商品参考图 + 品牌表单，生成 master_prompt 文件。

    auto_mode=True 时直接派 Celery 任务调 Gemini 跑 LLM，状态转 PROCESSING；
    auto_mode=False 时（默认）状态转 AWAITING_LLM_INPUT，用户手动粘贴 LLM 输出。
    """
    job_id = str(uuid.uuid4())
    workdir = _job_dir(job_id)

    # 保存视频
    video_ext = os.path.splitext(sample_video.filename or "")[1].lower() or ".mp4"
    video_path = workdir / f"sample{video_ext}"
    _save_upload_to(sample_video, video_path)

    # 保存商品图
    image_paths: List[str] = []
    for idx, img in enumerate(product_images):
        if not img.filename:
            continue
        ext = os.path.splitext(img.filename)[1].lower() or ".jpg"
        p = workdir / f"product_{idx + 1:02d}{ext}"
        _save_upload_to(img, p)
        image_paths.append(str(p).replace("\\", "/"))

    # 解析品牌表单 → 渲染 master_prompt
    try:
        brand_dict = json.loads(brand) if brand else None
    except json.JSONDecodeError:
        raise HTTPException(400, "品牌字段不是合法 JSON")
    block = build_brand_config_block(brand_dict)
    master_prompt_text = render_master_prompt(block)

    master_prompt_path = workdir / "master_prompt_rendered.md"
    master_prompt_path.write_text(master_prompt_text, encoding="utf-8")

    gu_dir = workdir / "gus"

    initial_status = GroupStatus.PROCESSING if auto_mode else GroupStatus.AWAITING_LLM_INPUT
    chosen_model = (gemini_model or "").strip() or None

    group = TaskGroup(
        id=job_id,
        user_id=current_user.id,
        title=title or "未命名复刻作业",
        task_type=TaskType.IMAGE_TO_VIDEO,
        source=TaskSource.STORYBOARD,
        status=initial_status,
        global_prompt=(brand_dict or {}).get("brand_name", "")[:200] if brand_dict else None,
        config_json={
            "video_path": str(video_path).replace("\\", "/"),
            "product_image_paths": image_paths,
            "brand_config": brand_dict or {},
            "master_prompt_path": str(master_prompt_path).replace("\\", "/"),
            "gu_output_dir": str(gu_dir).replace("\\", "/"),
            "gu_count": 0,
            "llm_output_path": None,
            "auto_mode": bool(auto_mode),
            "gemini_model": chosen_model,
        },
        progress_message="排队等待 Gemini 分析…" if auto_mode else None,
        total_count=0,
    )
    db.add(group)
    db.commit()
    db.refresh(group)

    if auto_mode:
        from app.workers.replicate_tasks import run_storyboard_llm
        run_storyboard_llm.delay(job_id)

    return {
        "id": group.id,
        "title": group.title,
        "status": group.status.value,
        "master_prompt": master_prompt_text,
        "video_path": group.config_json["video_path"],
        "product_image_paths": image_paths,
        "auto_mode": bool(auto_mode),
        "gemini_model": chosen_model,
        "created_at": group.created_at,
    }


# ─────────────────────────────────────────────────────────────────────
# 2. 列表 / 详情
# ─────────────────────────────────────────────────────────────────────
@router.get("/jobs")
def list_jobs(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(TaskGroup)
        .filter(
            TaskGroup.user_id == current_user.id,
            TaskGroup.source == TaskSource.STORYBOARD,
        )
        .order_by(TaskGroup.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": g.id,
            "title": g.title,
            "status": g.status.value if g.status else None,
            "gu_count": (g.config_json or {}).get("gu_count", 0),
            "auto_mode": (g.config_json or {}).get("auto_mode", False),
            "progress_message": g.progress_message,
            "created_at": g.created_at,
        }
        for g in rows
    ]


@router.get("/jobs/{job_id}")
def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = _load_job(db, job_id, current_user)
    cfg = group.config_json or {}
    master_prompt_path = cfg.get("master_prompt_path")
    master_prompt_text = ""
    if master_prompt_path and Path(master_prompt_path).exists():
        master_prompt_text = Path(master_prompt_path).read_text(encoding="utf-8")
    return {
        "id": group.id,
        "title": group.title,
        "status": group.status.value if group.status else None,
        "gu_count": cfg.get("gu_count", 0),
        "video_path": cfg.get("video_path"),
        "product_image_paths": cfg.get("product_image_paths", []),
        "brand_config": cfg.get("brand_config", {}),
        "master_prompt": master_prompt_text,
        "auto_mode": cfg.get("auto_mode", False),
        "gemini_model": cfg.get("gemini_model"),
        "gemini_model_used": cfg.get("gemini_model_used"),
        "gemini_usage": cfg.get("gemini_usage"),
        "progress_message": group.progress_message,
        "created_at": group.created_at,
    }


# ─────────────────────────────────────────────────────────────────────
# 3. 接收 LLM 输出 → 拆 GU
# ─────────────────────────────────────────────────────────────────────
class LLMOutputRequest(BaseModel):
    llm_output: str


@router.post("/jobs/{job_id}/llm-output")
def submit_llm_output(
    job_id: str,
    req: LLMOutputRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = _load_job(db, job_id, current_user)
    if group.status not in (GroupStatus.AWAITING_LLM_INPUT, GroupStatus.COMPLETED):
        raise HTTPException(400, f"作业当前状态 {group.status} 不允许提交 LLM 输出")

    if not req.llm_output.strip():
        raise HTTPException(400, "LLM 输出为空")

    cfg = dict(group.config_json or {})
    workdir = Path(cfg.get("master_prompt_path", "")).parent if cfg.get("master_prompt_path") else _job_dir(job_id)

    # 保存原始 LLM 输出（便于二次解析 / 调试）
    llm_output_path = workdir / "full_llm_output.md"
    llm_output_path.write_text(req.llm_output, encoding="utf-8")

    gus = parse_llm_output(req.llm_output)
    if not gus:
        raise HTTPException(400, "未能从 LLM 输出里识别出任何 GU 块；请确认输出包含 ═══【GU01/...】 这类分隔标记")

    gu_dir = Path(cfg.get("gu_output_dir") or (workdir / "gus"))
    save_gus_to_dir(gus, gu_dir)

    cfg.update({
        "llm_output_path": str(llm_output_path).replace("\\", "/"),
        "gu_output_dir": str(gu_dir).replace("\\", "/"),
        "gu_count": len(gus),
    })
    group.config_json = cfg
    group.total_count = len(gus)
    group.status = GroupStatus.COMPLETED
    db.commit()
    db.refresh(group)

    return {
        "id": group.id,
        "status": group.status.value,
        "gu_count": len(gus),
    }


# ─────────────────────────────────────────────────────────────────────
# 4. 列 GU
# ─────────────────────────────────────────────────────────────────────
@router.get("/jobs/{job_id}/gus")
def list_gus(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = _load_job(db, job_id, current_user)
    cfg = group.config_json or {}
    gu_dir = Path(cfg.get("gu_output_dir") or "")
    if not gu_dir.exists():
        return []

    # 读 LLM 原文，重新 parse 出每个 GU 的 A/B 文本（落盘文件已写过，但前端要列就直接重 parse 也快）
    llm_output_path = cfg.get("llm_output_path")
    if not llm_output_path or not Path(llm_output_path).exists():
        return []
    llm_text = Path(llm_output_path).read_text(encoding="utf-8")
    gus = parse_llm_output(llm_text)

    # 关联 Phase 3 已经派生的 image/video Tasks（按 gu_id 索引）
    children = (
        db.query(Task)
        .filter(Task.group_id == job_id)
        .all()
    )
    by_gu: dict[str, dict] = {}
    for t in children:
        cfg_t = t.config_json or {}
        gid = cfg_t.get("gu_id")
        kind = cfg_t.get("kind")  # "image" | "video"
        if not gid or not kind:
            continue
        bucket = by_gu.setdefault(gid, {"image": None, "video": None})
        # 同一 GU 同一 kind 取最新一条
        if not bucket[kind] or (t.created_at and bucket[kind]["created_at"] < t.created_at):
            bucket[kind] = {
                "task_id": t.id,
                "status": t.status.value if t.status else None,
                "output_file": t.output_file,
                "error_message": t.error_message,
                "created_at": t.created_at,
            }

    out = []
    for gu in gus:
        gid = gu["gu_id"]
        out.append({
            "gu_id": gid,
            "pipeline_a_image": gu.get("pipeline_a_image"),
            "pipeline_b_video": gu.get("pipeline_b_video"),
            "cli_payload": gu.get("cli_payload"),
            "image_task": (by_gu.get(gid) or {}).get("image"),
            "video_task": (by_gu.get(gid) or {}).get("video"),
        })
    return out


# ─────────────────────────────────────────────────────────────────────
# 5. Phase 3 — 一键调 HOLO 出图 / 出视频
# ─────────────────────────────────────────────────────────────────────
class GenerateImageRequest(BaseModel):
    # 9 宫格图天然方形 — 用 HOLO 的 GPT-images2 1:1 变体
    model: str = "GPT-images2 1:1"
    aspect_ratio: Optional[str] = None


class GenerateVideoRequest(BaseModel):
    """产线 B 视频生成 — 走 Dreamina CLI（即梦），seedance2.0fast 默认。"""
    model_version: str = "seedance2.0fast"   # 也接 seedance2.0 / seedance2.0_vip / seedance2.0fast_vip
    duration: Optional[int] = None           # 不传 → 用 LLM 输出的 cli_payload.duration
    video_resolution: Optional[str] = None   # 不传 → 用 cli_payload.video_resolution（默认 720p）
    image_path: Optional[str] = None         # 不传 → 默认第一张商品参考图
    prompt_override: Optional[str] = None    # 不传 → 用 LLM 输出的 cli_payload.prompt


@router.post("/jobs/{job_id}/gus/{gu_id}/generate-image")
def generate_image(
    job_id: str,
    gu_id: str,
    req: GenerateImageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = _load_job(db, job_id, current_user)
    cfg = group.config_json or {}
    if not cfg.get("llm_output_path"):
        raise HTTPException(400, "LLM 输出尚未提交，无法触发出图")

    llm_text = Path(cfg["llm_output_path"]).read_text(encoding="utf-8")
    gus = {g["gu_id"]: g for g in parse_llm_output(llm_text)}
    gu = gus.get(gu_id)
    if not gu:
        raise HTTPException(404, f"GU {gu_id} 不存在")
    if not gu.get("pipeline_a_image"):
        raise HTTPException(400, f"GU {gu_id} 没有 [产线 A] 提示词，无法出图")

    # 用商品图作为参考输入
    input_files = list(cfg.get("product_image_paths") or [])

    task = Task(
        id=str(uuid.uuid4()),
        group_id=job_id,
        user_id=current_user.id,
        prompt=gu["pipeline_a_image"],
        input_files=input_files,
        config_json={
            "gu_id": gu_id,
            "kind": "image",
            "model": req.model,
            "aspect_ratio": req.aspect_ratio or "1:1",
        },
        status=TaskStatus.QUEUED,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    from app.workers.tasks import process_generation
    process_generation.delay(task.id)

    return {
        "task_id": task.id,
        "gu_id": gu_id,
        "kind": "image",
        "status": task.status.value,
    }


@router.post("/jobs/{job_id}/gus/{gu_id}/generate-video")
def generate_video(
    job_id: str,
    gu_id: str,
    req: GenerateVideoRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """产线 B：调 Dreamina CLI（seedance2.0 fast 默认）。

    优先用 LLM 在 (B9) 里给出的 cli_payload（model_version/duration/resolution/prompt）；
    用户在请求里显式传的字段会覆盖 cli_payload。
    """
    group = _load_job(db, job_id, current_user)
    cfg = group.config_json or {}
    if not cfg.get("llm_output_path"):
        raise HTTPException(400, "LLM 输出尚未提交，无法触发出视频")

    llm_text = Path(cfg["llm_output_path"]).read_text(encoding="utf-8")
    gus = {g["gu_id"]: g for g in parse_llm_output(llm_text)}
    gu = gus.get(gu_id)
    if not gu:
        raise HTTPException(404, f"GU {gu_id} 不存在")
    if not gu.get("pipeline_b_video"):
        raise HTTPException(400, f"GU {gu_id} 没有 [产线 B] 提示词，无法出视频")

    # cli_payload 优先 → req 覆盖
    payload = gu.get("cli_payload") or {}
    model_version = req.model_version or payload.get("model_version") or "seedance2.0fast"
    duration = req.duration if req.duration is not None else payload.get("duration", 15)
    video_resolution = req.video_resolution or payload.get("video_resolution") or "720p"
    prompt_text = (req.prompt_override or payload.get("prompt") or gu["pipeline_b_video"]).strip()
    if not prompt_text:
        raise HTTPException(400, f"GU {gu_id} 没有可用的 prompt（B9 缺失且 pipeline_b_video 为空）")

    # 视频 input：优先用本 GU 已经生成的图，其次用 req.image_path，最后回退到第一张商品图
    image_path = req.image_path
    if not image_path:
        prior_images = (
            db.query(Task)
            .filter(Task.group_id == job_id, Task.status == TaskStatus.SUCCESS)
            .all()
        )
        for t in prior_images:
            cfg_t = t.config_json or {}
            if cfg_t.get("gu_id") == gu_id and cfg_t.get("kind") == "image" and t.output_file:
                image_path = t.output_file
                break
    if not image_path:
        prods = cfg.get("product_image_paths") or []
        if prods:
            image_path = prods[0]
    if not image_path:
        raise HTTPException(400, "找不到可用的输入图（建议先一键出图，或在请求里传 image_path）")

    task = Task(
        id=str(uuid.uuid4()),
        group_id=job_id,
        user_id=current_user.id,
        prompt=prompt_text,
        input_files=[image_path],
        config_json={
            "gu_id": gu_id,
            "kind": "video",
            "provider": "dreamina",
            "model_version": model_version,
            "duration": int(duration),
            "video_resolution": video_resolution,
        },
        status=TaskStatus.QUEUED,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    from app.workers.replicate_tasks import run_video_via_dreamina
    run_video_via_dreamina.delay(task.id)

    return {
        "task_id": task.id,
        "gu_id": gu_id,
        "kind": "video",
        "provider": "dreamina",
        "model_version": model_version,
        "duration": int(duration),
        "status": task.status.value,
    }


# ─────────────────────────────────────────────────────────────────────
# 6. 删除作业（清磁盘 + 子任务级联 cascade=delete-orphan 自动）
# ─────────────────────────────────────────────────────────────────────
@router.delete("/jobs/{job_id}")
def delete_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = _load_job(db, job_id, current_user)
    cfg = group.config_json or {}
    workdir = Path(cfg.get("master_prompt_path", "")).parent if cfg.get("master_prompt_path") else None
    db.delete(group)
    db.commit()
    if workdir and workdir.exists() and str(workdir).startswith(str(REPLICATE_BASE)):
        try:
            shutil.rmtree(workdir)
        except Exception as e:
            logger.warning(f"replicate delete: rmtree {workdir} failed: {e}")
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────
# 工具
# ─────────────────────────────────────────────────────────────────────
def _load_job(db: Session, job_id: str, user: User) -> TaskGroup:
    group = (
        db.query(TaskGroup)
        .filter(
            TaskGroup.id == job_id,
            TaskGroup.user_id == user.id,
            TaskGroup.source == TaskSource.STORYBOARD,
        )
        .first()
    )
    if not group:
        raise HTTPException(404, "复刻作业不存在")
    return group
