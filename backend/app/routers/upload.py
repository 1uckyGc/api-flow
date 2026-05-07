import os
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import List
from app.routers.auth import get_current_user
from app.models.user import User
from app.utils.logger import logger

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

# 文件头 Magic Number 签名映射
IMAGE_SIGNATURES = {
    b"\xff\xd8\xff": {".jpg", ".jpeg"},
    b"\x89PNG\r\n\x1a\n": {".png"},
    b"RIFF": {".webp"},  # WebP: RIFF....WEBP, 进一步校验在下面
    b"GIF87a": {".gif"},
    b"GIF89a": {".gif"},
}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB
CHUNK_SIZE = 1024 * 1024  # 1MB per chunk


def _detect_real_ext(header: bytes) -> str | None:
    """按文件头 magic number 推断真实扩展名；推不出返回 None。"""
    if header.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if header.startswith(b"GIF87a") or header.startswith(b"GIF89a"):
        return ".gif"
    if header.startswith(b"RIFF") and len(header) >= 12 and header[8:12] == b"WEBP":
        return ".webp"
    return None


@router.post("/")
async def upload_files(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user)
):
    uploaded_paths = []
    
    for file in files:
        if not file.filename:
            continue
            
        claimed_ext = os.path.splitext(file.filename)[1].lower()

        try:
            # 读取文件头，按 magic number 决定真实扩展名（无视用户名称的扩展名）
            header = await file.read(16)
            real_ext = _detect_real_ext(header)
            if real_ext is None:
                logger.warning(
                    f"Upload rejected: not a recognized image (filename={file.filename!r}, "
                    f"content_type={file.content_type}, header_hex={header.hex()})"
                )
                raise HTTPException(
                    status_code=400,
                    detail="无法识别的图片格式（仅支持 JPG/PNG/WebP/GIF）"
                )

            if claimed_ext != real_ext:
                logger.info(
                    f"Upload ext corrected: {file.filename!r} claimed {claimed_ext}, real is {real_ext}"
                )

            ext = real_ext
            new_filename = f"{uuid.uuid4().hex}{ext}"
            filepath = os.path.join("uploads", new_filename)
            
            # 分块写入，避免大文件一次性占满内存
            total_size = len(header)
            with open(filepath, "wb") as f:
                f.write(header)
                while True:
                    chunk = await file.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    total_size += len(chunk)
                    if total_size > MAX_FILE_SIZE:
                        f.close()
                        os.remove(filepath)
                        logger.warning(
                            f"Upload rejected: too large (filename={file.filename!r}, "
                            f"size>={total_size}, limit={MAX_FILE_SIZE})"
                        )
                        raise HTTPException(
                            status_code=400,
                            detail=f"文件大小超过限制 ({MAX_FILE_SIZE // 1024 // 1024}MB)"
                        )
                    f.write(chunk)
            
            uploaded_paths.append(filepath.replace("\\", "/"))
        except HTTPException:
            raise
        except Exception as e:
            # 清理可能残留的半写文件
            if os.path.exists(filepath):
                os.remove(filepath)
            raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")
            
    return {"paths": uploaded_paths}
