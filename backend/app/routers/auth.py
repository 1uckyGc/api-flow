import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta

from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse, Token
from app import models, schemas
from app.services.auth_service import get_password_hash, verify_password, create_access_token
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

@router.post("/register", response_model=schemas.UserResponse)
def register(user_in: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == user_in.username).first():
        raise HTTPException(status_code=400, detail="该用户名已被注册")
    
    hashed_password = get_password_hash(user_in.password)
    db_user = models.User(
        username=user_in.username,
        hashed_password=hashed_password,
        display_name=user_in.username
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.post("/login", response_model=schemas.Token) # Changed to schemas.Token
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first() # Changed to models.User
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码不正确",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "id": user.id}, expires_delta=access_token_expires
    )
    
    user_payload = {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "is_active": user.is_active,
        "created_at": user.created_at,
        "is_admin": user.username == "admin",
    }
    return {"access_token": access_token, "token_type": "bearer", "user": user_payload}

from jose import jwt, JWTError

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="认证凭据无效",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

@router.get("/me", response_model=UserResponse)
def read_users_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "is_active": current_user.is_active,
        "created_at": current_user.created_at,
        "is_admin": current_user.username == "admin",
    }
