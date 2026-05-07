from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.settings import SystemSettings
from app.schemas.settings import SystemSettingsUpdate, SystemSettingsResponse
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/settings", tags=["settings"])

def get_or_create_settings(db: Session, user_id: int) -> SystemSettings:
    settings = db.query(SystemSettings).filter(SystemSettings.user_id == user_id).first()
    if not settings:
        settings = SystemSettings(user_id=user_id)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

@router.get("/", response_model=SystemSettingsResponse)
def get_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return get_or_create_settings(db, current_user.id)

@router.put("/", response_model=SystemSettingsResponse)
def update_settings(
    settings_in: SystemSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    settings = get_or_create_settings(db, current_user.id)
    
    # Update properties
    for var, value in vars(settings_in).items():
        setattr(settings, var, value)
        
    db.commit()
    db.refresh(settings)
    return settings
