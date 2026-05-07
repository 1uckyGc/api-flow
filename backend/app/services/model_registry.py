"""
模型注册表：根据模型名识别 provider 与任务类型。
取代以前 AI_PROVIDER 全局开关；HOLO / Flow2API / Grok 三家可同时存活。

- HOLO 模型名见 API-Reference 1.4.md（GPT-Images / gemini-3.x / imagen-4 / veo_3_1_*）
- Grok 模型名前缀 grok-imagine-（来自 grok_client.py 文件头）
- Flow2API 老命名带 _ultra / _ultra_relaxed / _ultra_fl 关键字
- 不命中所有规则时回退到 settings.AI_PROVIDER
"""

GROK_MODEL_PREFIXES = (
    "grok-",
)

FLOW2API_MODEL_KEYWORDS = (
    "_ultra",
)

HOLO_MODEL_PREFIXES = (
    "GPT-Images",
    "gemini-3.",
    "imagen-",
    "veo_3_",
)

# 显式 provider 前缀（最高优先级，可消歧重名模型）：
# 例 "flow2api/veo_3_1_r2v_fast_portrait" 显式走 Flow2API，
# 而 "veo_3_1_r2v_fast_portrait" 走 HOLO（前缀规则 "veo_3_"）。
EXPLICIT_PROVIDER_PREFIXES = ("flow2api/", "grok/", "holo/")


def resolve_provider(model: str, fallback: str = "holo") -> str:
    """根据模型名返回 'holo' / 'flow2api' / 'grok' / fallback。"""
    if not model:
        return fallback
    m = model.strip()

    # 1. 显式前缀（最高优先）
    for p in EXPLICIT_PROVIDER_PREFIXES:
        if m.startswith(p):
            return p[:-1]   # 去掉尾部斜杠

    # 2. Grok 命名规则
    for p in GROK_MODEL_PREFIXES:
        if m.startswith(p):
            return "grok"

    # 3. Flow2API 老别名关键字
    for kw in FLOW2API_MODEL_KEYWORDS:
        if kw in m:
            return "flow2api"

    # 4. HOLO 命名规则
    for p in HOLO_MODEL_PREFIXES:
        if m.startswith(p):
            return "holo"

    return fallback or "holo"


def strip_provider_prefix(model: str) -> str:
    """把 'flow2api/xxx' / 'holo/xxx' / 'grok/xxx' 还原为 'xxx'。无前缀直接返回。"""
    if not model:
        return model
    for p in EXPLICIT_PROVIDER_PREFIXES:
        if model.startswith(p):
            return model[len(p):]
    return model


def get_task_type(model: str) -> str:
    """从模型名推断任务类型（t2i / i2i / t2v / i2v / r2v / r2i / unknown）。
    HOLO 真值会从 GET /v1/tasks/{id} 的响应里覆盖；这里只用于初始记录与非 HOLO provider。
    """
    if not model:
        return "unknown"
    m = model.lower()

    if "_r2v" in m:
        return "r2v"
    if "_i2v" in m:
        return "i2v"
    if "_t2v" in m:
        return "t2v"
    if "video" in m:
        return "t2v"

    if "edit" in m:
        return "i2i"
    if "image" in m or m.startswith("imagen"):
        return "t2i"

    return "unknown"
