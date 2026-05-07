from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid
import logging

from app.database import get_db
from app.models.user import User
from app.models.workflow import Workflow, WorkflowRun, WorkflowRunStatus
from app.schemas.workflow import (
    WorkflowCreate, WorkflowUpdate, WorkflowResponse, WorkflowListItem,
    WorkflowRunCreate, WorkflowRunResponse, WorkflowRunListItem,
    ReviewSubmit, WorkflowExport, StepDefinition,
)
from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


# ── 模板 CRUD ──

@router.post("/", response_model=WorkflowResponse, status_code=status.HTTP_201_CREATED)
def create_workflow(
    payload: WorkflowCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = Workflow(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=payload.title,
        description=payload.description,
        steps_json=[s.model_dump() for s in payload.steps_json],
        input_schema=payload.input_schema,
    )
    db.add(wf)
    db.commit()
    db.refresh(wf)
    return wf


@router.get("/", response_model=List[WorkflowListItem])
def list_workflows(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Workflow)
        .filter(Workflow.user_id == current_user.id)
        .order_by(Workflow.created_at.desc())
        .all()
    )
    results = []
    for wf in rows:
        item = WorkflowListItem(
            id=wf.id,
            title=wf.title,
            description=wf.description,
            step_count=len(wf.steps_json) if wf.steps_json else 0,
            created_at=wf.created_at,
            updated_at=wf.updated_at,
        )
        results.append(item)
    return results


@router.get("/{workflow_id}", response_model=WorkflowResponse)
def get_workflow(
    workflow_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = (
        db.query(Workflow)
        .filter(Workflow.id == workflow_id, Workflow.user_id == current_user.id)
        .first()
    )
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return wf


@router.put("/{workflow_id}", response_model=WorkflowResponse)
def update_workflow(
    workflow_id: str,
    payload: WorkflowUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = (
        db.query(Workflow)
        .filter(Workflow.id == workflow_id, Workflow.user_id == current_user.id)
        .first()
    )
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if payload.title is not None:
        wf.title = payload.title
    if payload.description is not None:
        wf.description = payload.description
    if payload.steps_json is not None:
        wf.steps_json = [s.model_dump() for s in payload.steps_json]
    if payload.input_schema is not None:
        wf.input_schema = payload.input_schema

    db.commit()
    db.refresh(wf)
    return wf


@router.delete("/{workflow_id}", status_code=status.HTTP_200_OK)
def delete_workflow(
    workflow_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = (
        db.query(Workflow)
        .filter(Workflow.id == workflow_id, Workflow.user_id == current_user.id)
        .first()
    )
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    db.delete(wf)
    db.commit()
    return {"message": "Workflow deleted"}


# ── 导入 / 导出 ──

@router.get("/{workflow_id}/export", response_model=WorkflowExport)
def export_workflow(
    workflow_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = (
        db.query(Workflow)
        .filter(Workflow.id == workflow_id, Workflow.user_id == current_user.id)
        .first()
    )
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return WorkflowExport(
        title=wf.title,
        description=wf.description,
        steps_json=wf.steps_json,
        input_schema=wf.input_schema,
    )


@router.post("/import", response_model=WorkflowResponse, status_code=status.HTTP_201_CREATED)
def import_workflow(
    payload: WorkflowExport,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = Workflow(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=payload.title,
        description=payload.description,
        steps_json=payload.steps_json,
        input_schema=payload.input_schema,
    )
    db.add(wf)
    db.commit()
    db.refresh(wf)
    return wf


# ── 工作流执行 ──

@router.post("/{workflow_id}/run", response_model=WorkflowRunResponse, status_code=status.HTTP_201_CREATED)
def start_workflow_run(
    workflow_id: str,
    payload: WorkflowRunCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = (
        db.query(Workflow)
        .filter(Workflow.id == workflow_id, Workflow.user_id == current_user.id)
        .first()
    )
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    steps = wf.steps_json or []
    if not steps:
        raise HTTPException(status_code=400, detail="Workflow has no steps")

    # 初始化每个步骤的运行时状态
    steps_state = [
        {
            "step_index": i,
            "type": step.get("type", "unknown"),
            "status": "pending",
            "task_group_id": None,
            "output_files": [],
            "output_prompts": [],
            "stats": None,
            "error": None,
        }
        for i, step in enumerate(steps)
    ]

    run = WorkflowRun(
        id=str(uuid.uuid4()),
        workflow_id=wf.id,
        user_id=current_user.id,
        title=payload.title or wf.title,
        status=WorkflowRunStatus.RUNNING,
        current_step=0,
        steps_state=steps_state,
        input_files=payload.input_files,
        input_prompts=payload.input_prompts,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    # 发送到 Celery 开始执行
    from app.workers.workflow_worker import advance_workflow
    advance_workflow.delay(run.id, 0)

    return run


@router.get("/runs/", response_model=List[WorkflowRunListItem])
def list_workflow_runs(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    runs = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.user_id == current_user.id)
        .order_by(WorkflowRun.created_at.desc())
        .all()
    )
    return runs


@router.get("/runs/{run_id}", response_model=WorkflowRunResponse)
def get_workflow_run(
    run_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.id == run_id, WorkflowRun.user_id == current_user.id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return run


@router.post("/runs/{run_id}/review", response_model=WorkflowRunResponse)
def submit_review(
    run_id: str,
    payload: ReviewSubmit,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.id == run_id, WorkflowRun.user_id == current_user.id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    if run.status != WorkflowRunStatus.PAUSED:
        raise HTTPException(status_code=400, detail="Workflow is not paused for review")

    if not payload.selected_files:
        raise HTTPException(status_code=400, detail="Must select at least one file")

    # 更新当前审核步骤的 output
    steps_state = list(run.steps_state)
    review_step = steps_state[run.current_step]
    review_step["status"] = "completed"
    review_step["output_files"] = payload.selected_files
    if payload.selected_prompts is not None:
        review_step["output_prompts"] = payload.selected_prompts
    steps_state[run.current_step] = review_step
    run.steps_state = steps_state

    run.status = WorkflowRunStatus.RUNNING
    db.commit()
    db.refresh(run)

    # Phase 3 发送到 Celery 执行下一步
    from app.workers.workflow_worker import advance_workflow
    advance_workflow.delay(run.id, run.current_step + 1)

    return run


@router.post("/runs/{run_id}/abort", response_model=WorkflowRunResponse)
def abort_workflow_run(
    run_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.id == run_id, WorkflowRun.user_id == current_user.id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    if run.status in (WorkflowRunStatus.COMPLETED, WorkflowRunStatus.FAILED):
        raise HTTPException(status_code=400, detail="Workflow already finished")

    run.status = WorkflowRunStatus.FAILED
    run.error_message = "Aborted by user"
    db.commit()
    db.refresh(run)
    return run
