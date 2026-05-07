import os
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import List
from app.routers.auth import get_current_user
from app.models.user import User

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


def _validate_magic_number(header: bytes, ext: str) -> bool:
    """通过文件头字节校验真实文件类型是否与后缀匹配"""
    for signature, allowed_exts in IMAGE_SIGNATURES.items():
        if header.startswith(signature):
            if ext in allowed_exts:
                return True
            # WebP 需额外检查第 8-12 字节为 "WEBP"
            if signature == b"RIFF" and ext == ".webp":
                return len(header) >= 12 and header[8:12] == b"WEBP"
    return False


@router.post("/")
async def upload_files(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user)
):
    uploaded_paths = []
    
    for file in files:
        if not file.filename:
            continue
            
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext}")
            
        new_filename = f"{uuid.uuid4().hex}{ext}"
        filepath = os.path.join("uploads", new_filename)
        
        try:
            # 读取文件头用于 Magic Number 校验
            header = await file.read(16)
            if not _validate_magic_number(header, ext):
                raise HTTPException(
                    status_code=400,
                    detail=f"文件内容与后缀 {ext} 不匹配，疑似伪造文件"
                )
            
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
