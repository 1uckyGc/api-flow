"""generate_fission_prompts 的行为测试。

按 TDD tracer-bullet 起步，行为按优先级一条一条加。
"""
import json

import httpx
import pytest
import respx

from app.services.ai_service import (
    generate_director_scene_prompts,
    generate_fission_prompts,
)


DEEPSEEK_URL = "https://test.example.com/v1/chat/completions"


def _llm_response(prompts: list[str]) -> dict:
    """模拟 DeepSeek chat-completions 响应：内容是个 JSON 字符串字段。"""
    return {
        "choices": [{"message": {"content": json.dumps({"prompts": prompts})}}]
    }


def _llm_scenes_response(scenes: list[dict]) -> dict:
    """同上，但 content 内层 key 是 `scenes`，给导演模式用。"""
    return {
        "choices": [{"message": {"content": json.dumps({"scenes": scenes})}}]
    }


@pytest.fixture
def configured_settings(monkeypatch):
    """注入一个能正常发请求的 settings 子集。默认走非 vision 模型。"""
    monkeypatch.setattr("app.config.settings.DEEPSEEK_API_KEY", "fake-key")
    monkeypatch.setattr("app.config.settings.DEEPSEEK_API_URL", DEEPSEEK_URL)
    monkeypatch.setattr("app.config.settings.DEEPSEEK_MODEL", "deepseek-chat")


@pytest.fixture
def fake_png_path(tmp_path):
    """落一个最小可读的假 PNG 文件。base64 编码逻辑只在乎能 open + read。"""
    img = tmp_path / "fake.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\nfake-payload")
    return str(img)


# ── Tracer bullet ────────────────────────────────────────────────────────


async def test_returns_exactly_n_prompts_from_llm_response(configured_settings):
    """count=3 + LLM 返回 3 条 → 函数恰好返回这 3 条字符串。"""
    with respx.mock:
        respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(200, json=_llm_response(["a", "b", "c"]))
        )

        result = await generate_fission_prompts(global_prompt="any", count=3)

    assert result == ["a", "b", "c"]


# ── Critical correctness ─────────────────────────────────────────────────


async def test_pads_with_last_prompt_when_llm_returns_fewer(configured_settings):
    """LLM 返回少于 count → 用最后一条复制 pad 到 count。"""
    with respx.mock:
        respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(200, json=_llm_response(["alpha", "beta"]))
        )

        result = await generate_fission_prompts(global_prompt="any", count=4)

    assert result == ["alpha", "beta", "beta", "beta"]


async def test_truncates_when_llm_returns_more_than_count(configured_settings):
    """LLM 返回多于 count → 只取前 count 条。"""
    with respx.mock:
        respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(
                200, json=_llm_response(["one", "two", "three", "four", "five"])
            )
        )

        result = await generate_fission_prompts(global_prompt="any", count=2)

    assert result == ["one", "two"]


async def test_raises_runtime_error_when_api_key_missing(monkeypatch):
    """DEEPSEEK_API_KEY 为空 → 应在发请求前 RuntimeError，且错误信息提示 key 名。"""
    monkeypatch.setattr("app.config.settings.DEEPSEEK_API_KEY", "")

    with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
        await generate_fission_prompts(global_prompt="any", count=3)


# ── Resilience ───────────────────────────────────────────────────────────


async def test_retries_with_extra_user_message_when_first_response_is_not_json(
    configured_settings,
):
    """第一轮 LLM 返回非 JSON content → 函数应进行第二轮请求，且第二轮 payload
    比第一轮多一条 user 消息（注入更严格的格式约束）。"""
    bad_response = {"choices": [{"message": {"content": "this is not json"}}]}
    good_response = _llm_response(["recovered"])

    with respx.mock:
        route = respx.post(DEEPSEEK_URL).mock(
            side_effect=[
                httpx.Response(200, json=bad_response),
                httpx.Response(200, json=good_response),
            ]
        )

        result = await generate_fission_prompts(global_prompt="any", count=1)

    assert result == ["recovered"]
    assert route.call_count == 2

    first_msgs = json.loads(route.calls[0].request.content)["messages"]
    second_msgs = json.loads(route.calls[1].request.content)["messages"]
    assert len(second_msgs) > len(first_msgs)
    assert second_msgs[-1]["role"] == "user"


async def test_raises_runtime_error_when_all_retries_exhausted(configured_settings):
    """所有轮次都返回非 JSON → 函数最终抛 RuntimeError，错误信息提到 DeepSeek。"""
    bad_response = {"choices": [{"message": {"content": "still not json"}}]}

    with respx.mock:
        respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(200, json=bad_response)
        )

        with pytest.raises(RuntimeError, match="DeepSeek"):
            await generate_fission_prompts(global_prompt="any", count=1)


# ── Multimodal protocol routing ──────────────────────────────────────────


async def test_vision_model_with_images_uses_multimodal_payload(
    monkeypatch, fake_png_path
):
    """模型名含 vision 关键字 + 有 image_paths → user content 是 list 且包含 image_url。"""
    monkeypatch.setattr("app.config.settings.DEEPSEEK_API_KEY", "fake-key")
    monkeypatch.setattr("app.config.settings.DEEPSEEK_API_URL", DEEPSEEK_URL)
    monkeypatch.setattr("app.config.settings.DEEPSEEK_MODEL", "gemini-pro")

    with respx.mock:
        route = respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(200, json=_llm_response(["x"]))
        )

        await generate_fission_prompts(
            global_prompt="any", count=1, image_paths=[fake_png_path]
        )

    payload = json.loads(route.calls[0].request.content)
    user_msg = payload["messages"][1]  # [0]=system, [1]=user
    assert isinstance(user_msg["content"], list), "vision 模型应使用多模态 list content"
    assert any(
        part.get("type") == "image_url" for part in user_msg["content"]
    ), "应该有至少一块 image_url"


async def test_non_vision_model_with_images_falls_back_to_text_only_payload(
    configured_settings, fake_png_path
):
    """模型名不含 vision 关键字（默认 deepseek-chat） + 即使有 image_paths → user
    content 是 string，图片被丢弃。"""
    with respx.mock:
        route = respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(200, json=_llm_response(["x"]))
        )

        await generate_fission_prompts(
            global_prompt="any", count=1, image_paths=[fake_png_path]
        )

    payload = json.loads(route.calls[0].request.content)
    user_msg = payload["messages"][1]
    assert isinstance(user_msg["content"], str), "非 vision 模型应使用纯文本 content"


# ════════════════════════════════════════════════════════════════════════
#  generate_director_scene_prompts —— 剧本拆分
# ════════════════════════════════════════════════════════════════════════


async def test_director_returns_n_scenes_when_llm_returns_exact_count(configured_settings):
    """count=3 + LLM 返回 3 个 scene → 函数返回这 3 个 scene dict。"""
    scenes_in = [
        {"index": 1, "shot_type": "近景", "action": "登场", "description": "first"},
        {"index": 2, "shot_type": "中景", "action": "互动", "description": "second"},
        {"index": 3, "shot_type": "远景", "action": "收尾", "description": "third"},
    ]
    with respx.mock:
        respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(200, json=_llm_scenes_response(scenes_in))
        )

        result = await generate_director_scene_prompts(script="any", count=3)

    assert result == scenes_in


async def test_director_sorts_scenes_by_index_when_llm_returns_them_unordered(
    configured_settings,
):
    """LLM 乱序返回 → 按 index 升序排列后再返回（核心修复，不能漂）。"""
    scenes_unordered = [
        {"index": 3, "description": "third"},
        {"index": 1, "description": "first"},
        {"index": 2, "description": "second"},
    ]
    with respx.mock:
        respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(
                200, json=_llm_scenes_response(scenes_unordered)
            )
        )

        result = await generate_director_scene_prompts(script="any", count=3)

    assert [s["index"] for s in result] == [1, 2, 3]


async def test_director_pads_with_last_scene_when_llm_returns_fewer(
    configured_settings,
):
    """LLM 返回少于 count → 用最后一条复制 pad 到 count。"""
    scenes_in = [
        {"index": 1, "description": "a"},
        {"index": 2, "description": "b"},
    ]
    with respx.mock:
        respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(200, json=_llm_scenes_response(scenes_in))
        )

        result = await generate_director_scene_prompts(script="any", count=4)

    assert len(result) == 4
    assert result[2] == result[1]
    assert result[3] == result[1]


async def test_director_truncates_scenes_when_llm_returns_more_than_count(
    configured_settings,
):
    """LLM 返回多于 count → 排序后取前 count 条。"""
    scenes_in = [
        {"index": i, "description": f"scene-{i}"} for i in (5, 4, 3, 2, 1)
    ]  # 故意乱序，验证排序+截断同时工作
    with respx.mock:
        respx.post(DEEPSEEK_URL).mock(
            return_value=httpx.Response(200, json=_llm_scenes_response(scenes_in))
        )

        result = await generate_director_scene_prompts(script="any", count=2)

    assert [s["index"] for s in result] == [1, 2]


async def test_director_raises_runtime_error_when_api_key_missing(monkeypatch):
    """DEEPSEEK_API_KEY 为空 → RuntimeError，错误信息提到 DEEPSEEK_API_KEY。"""
    monkeypatch.setattr("app.config.settings.DEEPSEEK_API_KEY", "")

    with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
        await generate_director_scene_prompts(script="any", count=3)
