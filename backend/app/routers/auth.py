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
from app.services.followmeee_auth import (
    verify_via_followmeee,
    FollowmeeeAuthError,
    FollowmeeeAuthInvalid,
    extract_is_admin,
    extract_display_name,
)
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ─────────────────────────────────────────────────────────────────────────────
# 工具函数
# ─────────────────────────────────────────────────────────────────────────────

def _lazy_upsert_user(db: Session, username: str, display_name: str) -> User:
    """本地 users 表 idempotent 建行；外键 tasks.user_id / api_call_log.user_id 等需要 local id。

    hashed_password 存固定标记 '!followmeee-managed' — 本地不再做密码验证，
    防止 verify_password() 误命中（bcrypt 对 '!' 开头的 hash 也会 verify=False）。
    """
    user = db.query(User).filter(User.username == username).first()
    if user:
        if display_name and user.display_name != display_name:
            user.display_name = display_name
            db.commit()
            db.refresh(user)
        return user

    user = User(
        username=username,
        hashed_password="!followmeee-managed",
        display_name=display_name,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info(f"lazy-created local user from followmeee.co: {username}")
    return user


def _is_emergency_admin(username: str, password: str) -> bool:
    """检查是否匹配 .env 配置的离线 admin 凭据（只在 followmeee.co 不可达或登失败时启用）。"""
    emergency_user = settings.EMERGENCY_ADMIN_USERNAME
    emergency_hash = settings.EMERGENCY_ADMIN_PASSWORD_HASH
    if not emergency_user or not emergency_hash:
        return False
    return username == emergency_user and verify_password(password, emergency_hash)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/register", status_code=status.HTTP_410_GONE)
def register():
    """本地注册已停用 — 账户由 https://followmeee.co/manage 集中管理。"""
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="账户由 followmeee.co/manage 集中管理，api-flow 不再支持本地注册",
    )


@router.post("/login", response_model=schemas.Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(),
                db: Session = Depends(get_db)):
    """登录代理 followmeee.co + 离线 admin 兜底。

    流程：
      1. 主路径：调 followmeee.co /api/login
         - 200 → lazy upsert 本地 users 行 → 签 api-flow JWT
         - 401/422 → 凭据错；继续尝试离线 admin 兜底（一般不会命中，因为 emergency 通常用唯一 username）
         - 5xx / 网络错 → 上游不可达，进兜底
      2. 离线 admin 兜底：仅当 username == EMERGENCY_ADMIN_USERNAME 且密码 hash 匹配
      3. 都不通 → 401
    """
    username = form_data.username.strip()
    password = form_data.password

    is_admin = False
    display_name = username
    upstream_unreachable = False
    upstream_ok = False

    # ── 1. 主路径：followmeee.co
    try:
        upstream = await verify_via_followmeee(username, password)
        is_admin = extract_is_admin(upstream) or (username == settings.EMERGENCY_ADMIN_USERNAME)
        display_name = extract_display_name(upstream, fallback=username)
        upstream_ok = True
    except FollowmeeeAuthInvalid:
        pass  # 凭据被上游拒，落到下面兜底
    except FollowmeeeAuthError:
        upstream_unreachable = True

    # ── 2. 离线 admin 兜底
    if not upstream_ok and _is_emergency_admin(username, password):
        is_admin = True
        display_name = username
        upstream_ok = True
        logger.warning(f"emergency admin fallback used for user={username!r} "
                       f"(upstream_unreachable={upstream_unreachable})")

    # ── 3. 都没过
    if not upstream_ok:
        suffix = "（上游不可达）" if upstream_unreachable else ""
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"用户名或密码不正确{suffix}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ── 4. 写入本地 users 表（外键依赖）+ 签 JWT
    user_obj = _lazy_upsert_user(db, username, display_name)
    access_token = create_access_token(
        data={"sub": user_obj.username, "id": user_obj.id},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user_obj.id,
            "username": user_obj.username,
            "display_name": user_obj.display_name,
            "is_active": user_obj.is_active,
            "created_at": user_obj.created_at,
            "is_admin": is_admin,
        },
    }


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
    # is_admin: emergency admin username 始终为 true；其它账户从 username 派生（兼容旧前端约定）
    is_admin = current_user.username == settings.EMERGENCY_ADMIN_USERNAME or current_user.username == "admin"
    return {
        "id": current_user.id,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "is_active": current_user.is_active,
        "created_at": current_user.created_at,
        "is_admin": is_admin,
    }
