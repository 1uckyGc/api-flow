"""AIClient 实例方法的行为测试。

这两个方法是 AI 网关客户端的内部工具，但它们的正确性影响产线：
- _detect_file_type 决定每个生成结果落盘时的扩展名/MIME（错了 frontend 显示崩）
- _get_client 决定 Celery worker 在多次任务循环中是否能正确复用/重建连接池
"""
import asyncio

import pytest

from app.services.ai_service import AIClient, GenerationResult


@pytest.fixture
def client():
    return AIClient()


# ════════════════════════════════════════════════════════════════════════
#  _detect_file_type —— magic-byte 嗅探
# ════════════════════════════════════════════════════════════════════════


async def test_detect_file_type_recognizes_png(client):
    """\\x89PNG 起手 → image/png。"""
    result = GenerationResult(success=True, data=b"\x89PNG\r\n\x1a\n" + b"x" * 100)

    out = await client._detect_file_type(result, is_video=False)

    assert out.mime_type == "image/png"
    assert out.file_ext == ".png"
    assert out.media_type == "image"


async def test_detect_file_type_recognizes_jpeg(client):
    """\\xff\\xd8 起手 → image/jpeg。"""
    result = GenerationResult(success=True, data=b"\xff\xd8" + b"x" * 100)

    out = await client._detect_file_type(result, is_video=False)

    assert out.mime_type == "image/jpeg"
    assert out.file_ext == ".jpg"
    assert out.media_type == "image"


async def test_detect_file_type_recognizes_webp(client):
    """RIFF....WEBP → image/webp（注意 WEBP 标识在 offset 8）。"""
    result = GenerationResult(
        success=True, data=b"RIFF\x00\x00\x00\x00WEBP" + b"x" * 100
    )

    out = await client._detect_file_type(result, is_video=False)

    assert out.mime_type == "image/webp"
    assert out.file_ext == ".webp"
    assert out.media_type == "image"


async def test_detect_file_type_recognizes_mp4_by_ftyp_atom(client):
    """前 32 字节内出现 'ftyp' 子串 → video/mp4。"""
    result = GenerationResult(
        success=True, data=b"\x00\x00\x00\x20ftypisom" + b"x" * 100
    )

    out = await client._detect_file_type(result, is_video=False)

    assert out.mime_type == "video/mp4"
    assert out.file_ext == ".mp4"
    assert out.media_type == "video"


async def test_detect_file_type_falls_back_to_video_when_unrecognized_and_is_video(
    client,
):
    """未识别 magic + is_video=True → 兜底 video/mp4。"""
    result = GenerationResult(success=True, data=b"unknown-binary-payload")

    out = await client._detect_file_type(result, is_video=True)

    assert out.media_type == "video"
    assert out.mime_type == "video/mp4"
    assert out.file_ext == ".mp4"


async def test_detect_file_type_falls_back_to_image_when_unrecognized_and_not_video(
    client,
):
    """未识别 magic + is_video=False → 兜底 image/png。"""
    result = GenerationResult(success=True, data=b"unknown-binary-payload")

    out = await client._detect_file_type(result, is_video=False)

    assert out.media_type == "image"
    assert out.mime_type == "image/png"
    assert out.file_ext == ".png"


async def test_detect_file_type_returns_unchanged_when_data_too_short(client):
    """data 不足 4 字节 → 不修改 result 任何字段。"""
    result = GenerationResult(success=False, data=b"abc", mime_type="initial-mime")

    out = await client._detect_file_type(result, is_video=False)

    assert out.mime_type == "initial-mime"


# ════════════════════════════════════════════════════════════════════════
#  _get_client —— loop-bound 连接池
# ════════════════════════════════════════════════════════════════════════


async def test_get_client_returns_same_pool_within_same_loop(client):
    """同一个 event loop 内重复调用 → 拿到同一个连接池实例。"""
    pool_a = await client._get_client()
    pool_b = await client._get_client()

    assert pool_a is pool_b


async def test_get_client_recreates_pool_when_existing_pool_is_closed(client):
    """旧池子被 close 掉 → 下次取应得到一个新的、未关闭的池子。"""
    pool_a = await client._get_client()
    await pool_a.aclose()

    pool_b = await client._get_client()

    assert pool_a is not pool_b
    assert not pool_b.is_closed


async def test_get_client_creates_new_pool_when_called_from_different_loop(client):
    """在另一个 event loop 中调用 → 应重建池子（loop 漂移修复）。

    Python 3.14 的 asyncio 不允许在 running loop 里嵌套 run_until_complete，
    所以新 loop 必须跑在单独线程里 —— 这也更像产线场景：Celery worker 每次
    `asyncio.run(...)` 创建一次性 loop，然后退出。
    """
    pool_a = await client._get_client()

    def run_in_new_loop():
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(client._get_client())
        finally:
            loop.close()

    pool_b = await asyncio.to_thread(run_in_new_loop)

    assert pool_a is not pool_b
