"""
Storyboard 复刻引擎 — pipeline 核心函数。

从用户工程 storyboard_engine_v3.2 的 scripts/run_pipeline.py 提取出来，
转成 Web 集成友好的 importable 接口（不依赖 argparse / sys.path / 文件系统副作用）。

核心函数：
- render_master_prompt(brand_config_block) → 渲染主提示词文本
- parse_llm_output(llm_output) → 拆出 N 个 GU 的三段产线（A / B-zh / B-json），
  并把 [B-json] 解析后挂到 cli_payload 字段
- extract_summary_cli_payload(llm_output) → 兼容旧 v3.1 模板的 ===CLI_PAYLOAD=== 末尾汇总

模板版本兼容矩阵：
- v3.0：仅 [产线 A] / [产线 B] —— 无 cli_payload，dreamina 调用回退用 B 文本作为 prompt
- v3.1：旧版扩展，[产线 B] 内有 (B9) ```json``` + 末尾 ===CLI_PAYLOAD=== 汇总
- v3.2：[产线 A] / [产线 B-zh] / [产线 B-json] 三段（当前），
  [B-json] 含 duration_sec / shot_continuity / camera_motion / motion_timeline 等富字段
"""
import json
import re
from pathlib import Path
from typing import Any, Optional

PROMPTS_DIR = Path(__file__).parent / "prompts"
MASTER_PROMPT_FILE = PROMPTS_DIR / "01_master_prompt.md"


# ─────────────────────────────────────────────────────────────────────
# 1. 渲染主提示词
# ─────────────────────────────────────────────────────────────────────
def render_master_prompt(brand_config_block: Optional[str] = None) -> str:
    """读 master_prompt 模板并替换 {{BRAND_CONFIG_BLOCK}} 占位符。

    brand_config_block: 已格式化好的品牌配置块文本；None 时插入"未提供"占位文案。
    """
    template = MASTER_PROMPT_FILE.read_text(encoding="utf-8")
    block = brand_config_block or "（用户未提供品牌产品配置 - 跳过场景化逻辑置换，只做去重改写）"
    return template.replace("{{BRAND_CONFIG_BLOCK}}", block)


def build_brand_config_block(brand: Optional[dict]) -> Optional[str]:
    """把前端表单收集的品牌字段拼成 master_prompt 期待的块文本。

    brand 期望形如：
        {
            "brand_name": "...",
            "product_name": "...",
            "core_selling_points": ["...", "..."],
            "target_users": "...",
            "pain_points": ["...", "..."],
        }
    全部字段可选；任一无值返回 None（让 render 用默认占位）。
    """
    if not brand:
        return None
    if not any([
        (brand.get("brand_name") or "").strip(),
        (brand.get("product_name") or "").strip(),
        brand.get("core_selling_points"),
        (brand.get("target_users") or "").strip(),
        brand.get("pain_points"),
    ]):
        return None

    def _list_block(items, fallback="（未填写）"):
        if not items:
            return fallback
        if isinstance(items, str):
            items = [items]
        return "\n  - " + "\n  - ".join(str(x).strip() for x in items if str(x).strip())

    lines = [
        f"品牌名称：{(brand.get('brand_name') or '（未填写）').strip()}",
        f"产品名称：{(brand.get('product_name') or '（未填写）').strip()}",
        f"核心卖点：{_list_block(brand.get('core_selling_points'))}",
        f"目标用户：{(brand.get('target_users') or '（未填写）').strip()}",
        f"用户痛点：{_list_block(brand.get('pain_points'))}",
    ]
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────
# 2. 解析 LLM 输出 → GU 列表
# ─────────────────────────────────────────────────────────────────────
GU_SPLIT_PATTERN = re.compile(r"(?=═+\s*【GU\d+\s*[/／])")
GU_ID_PATTERN = re.compile(r"【GU(\d+)\s*[/／]")

# 产线段落起点：v3.2 是 `[产线 A]` / `[产线 B-zh]` / `[产线 B-json]`；
# v3.0/3.1 是 `[产线 A]` / `[产线 B]`（统一抓取）
PIPELINE_A_PATTERN = re.compile(
    r"\[产线\s*A\].*?(?=\[产线\s*B(-zh|-json)?\b|$)",
    re.DOTALL,
)
# 单一 [产线 B]（v3.0/3.1）— 包含 (B1)-(B9)
PIPELINE_B_LEGACY_PATTERN = re.compile(
    r"\[产线\s*B\]\s*(?!-).*?(?=──+\s*\(C\)|═+\s*【GU\d+\s*[/／]|$)",
    re.DOTALL,
)
# v3.2 新增：[产线 B-zh] 中文口语版
PIPELINE_B_ZH_PATTERN = re.compile(
    r"\[产线\s*B-zh\].*?(?=\[产线\s*B-json\]|═+\s*【GU\d+\s*[/／]|$)",
    re.DOTALL,
)
# v3.2 新增：[产线 B-json] JSON 参数包
PIPELINE_B_JSON_PATTERN = re.compile(
    r"\[产线\s*B-json\].*?(?=──+\s*\(C\)|═+\s*【GU\d+\s*[/／]|$)",
    re.DOTALL,
)
# (B9) JSON 块：旧 v3.1 扩展模板用 (B9) DREAMINA_CLI_JSON ```json``` 形态
B9_JSON_PATTERN = re.compile(
    r"\(B9\)[\s\S]*?```json\s*(\{[\s\S]*?\})\s*```",
    re.IGNORECASE,
)
# v3.2：`[产线 B-json]` 之后的第一个 ```json``` 块
BJSON_BLOCK_PATTERN = re.compile(
    r"```json\s*(\{[\s\S]*?\})\s*```",
)
# 末尾汇总：===CLI_PAYLOAD=== ... ===CLI_PAYLOAD_END=== （仅旧 v3.1 扩展模板有）
SUMMARY_CLI_PAYLOAD_PATTERN = re.compile(
    r"===\s*CLI_PAYLOAD\s*===\s*(?:```(?:json)?\s*)?([\s\S]*?)(?:\s*```)?\s*===\s*CLI_PAYLOAD_END\s*===",
    re.IGNORECASE,
)


def _safe_parse_json(text: str) -> Optional[Any]:
    """容忍 trailing comma / 单引号字段名的简易 JSON 解析；失败返回 None。"""
    if not text or not text.strip():
        return None
    s = text.strip()
    # 去掉常见 trailing comma：`{...,\n}` `,\n]`
    s = re.sub(r",\s*([}\]])", r"\1", s)
    try:
        return json.loads(s)
    except Exception:
        return None


def extract_summary_cli_payload(llm_output: str) -> Optional[list[dict]]:
    """抽末尾 ===CLI_PAYLOAD=== 之间的 JSON 数组；返回 list[dict] 或 None。"""
    if not llm_output:
        return None
    m = SUMMARY_CLI_PAYLOAD_PATTERN.search(llm_output)
    if not m:
        return None
    parsed = _safe_parse_json(m.group(1))
    if isinstance(parsed, list):
        return [x for x in parsed if isinstance(x, dict)]
    return None


def parse_llm_output(llm_output: str) -> list[dict]:
    """从 LLM 完整输出里抓出每个 GU 的双产线提示词块 + (B9) Dreamina CLI JSON。

    返回 list[dict]，每个 dict 形如：
        {
            "gu_id": "01",
            "full": "...",
            "pipeline_a_image": "...",   # 可能为 None
            "pipeline_b_video": "...",   # 可能为 None（含 B1-B9 全部段）
            "cli_payload": {...},        # (B9) JSON 解析结果，可能为 None
        }

    汇总规则：先解每个 GU 内的 (B9) JSON，再用末尾 ===CLI_PAYLOAD=== 汇总 override（若汇总里有同 gu_id）。
    """
    if not llm_output:
        return []

    summary = extract_summary_cli_payload(llm_output) or []
    summary_by_id: dict[str, dict] = {}
    for obj in summary:
        gid = str(obj.get("gu_id") or "").strip().zfill(2)
        if gid:
            summary_by_id[gid] = obj

    blocks = GU_SPLIT_PATTERN.split(llm_output)
    result = []
    for block in blocks:
        m = GU_ID_PATTERN.search(block)
        if not m:
            continue
        gu_id = m.group(1).zfill(2)

        a_match = PIPELINE_A_PATTERN.search(block)
        b_zh_match = PIPELINE_B_ZH_PATTERN.search(block)
        b_json_match = PIPELINE_B_JSON_PATTERN.search(block)
        b_legacy_match = PIPELINE_B_LEGACY_PATTERN.search(block) if not (b_zh_match or b_json_match) else None

        # 整段 pipeline_b_video — v3.2 把 B-zh + B-json 文本拼起来供前端复制；
        # v3.0/3.1 退化用 PIPELINE_B_LEGACY_PATTERN
        if b_zh_match or b_json_match:
            parts = []
            if b_zh_match:
                parts.append(b_zh_match.group(0).strip())
            if b_json_match:
                parts.append(b_json_match.group(0).strip())
            pipeline_b_video = "\n\n".join(parts) if parts else None
        elif b_legacy_match:
            pipeline_b_video = b_legacy_match.group(0).strip()
        else:
            pipeline_b_video = None

        # cli_payload 解析顺序：v3.2 [B-json] block → v3.1 (B9) → 末尾汇总（v3.1 only）
        cli_payload: Optional[dict] = None
        if b_json_match:
            bjm = BJSON_BLOCK_PATTERN.search(b_json_match.group(0))
            if bjm:
                parsed = _safe_parse_json(bjm.group(1))
                if isinstance(parsed, dict):
                    cli_payload = parsed
        if cli_payload is None:
            b9 = B9_JSON_PATTERN.search(block)
            if b9:
                parsed = _safe_parse_json(b9.group(1))
                if isinstance(parsed, dict):
                    cli_payload = parsed
        if gu_id in summary_by_id:
            # 汇总只在 v3.1 扩展模板里出现，覆盖 inline (B9) 但不覆盖 v3.2 的 [B-json]
            if cli_payload is None or "duration_sec" not in cli_payload:
                cli_payload = summary_by_id[gu_id]

        # 兜底字段（无论哪个版本，确保 dreamina 能至少跑起来）
        if cli_payload is not None:
            cli_payload.setdefault("gu_id", f"GU{gu_id}")
            # v3.2 的 duration_sec / v3.1 的 duration / 兜底 15
            if "duration_sec" not in cli_payload and "duration" not in cli_payload:
                cli_payload["duration_sec"] = 15

        result.append({
            "gu_id": gu_id,
            "full": block.strip(),
            "pipeline_a_image": a_match.group(0).strip() if a_match else None,
            "pipeline_b_video": pipeline_b_video,
            "pipeline_b_zh": b_zh_match.group(0).strip() if b_zh_match else None,
            "pipeline_b_json_text": b_json_match.group(0).strip() if b_json_match else None,
            "cli_payload": cli_payload,
        })
    return result


# ─────────────────────────────────────────────────────────────────────
# 3. 把解析结果落盘（per-GU 多文件，便于直接下载/复制粘贴）
# ─────────────────────────────────────────────────────────────────────
def save_gus_to_dir(gus: list[dict], out_dir: Path) -> dict:
    """把 parse_llm_output 的结果分文件写到 out_dir。

    返回 {"gu_count": N, "files": [...], "cli_payload_count": M}
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    cli_count = 0
    for gu in gus:
        gid = gu["gu_id"]
        full_path = out_dir / f"gu_{gid}_full.txt"
        full_path.write_text(gu["full"], encoding="utf-8")
        files.append(str(full_path))
        if gu.get("pipeline_a_image"):
            p = out_dir / f"gu_{gid}_pipeline_A_image.txt"
            p.write_text(gu["pipeline_a_image"], encoding="utf-8")
            files.append(str(p))
        # v3.2: 单独存 B-zh / B-json 两份；v3.0/3.1: 只存合并的 pipeline_b_video
        if gu.get("pipeline_b_zh"):
            p = out_dir / f"gu_{gid}_pipeline_B_zh.txt"
            p.write_text(gu["pipeline_b_zh"], encoding="utf-8")
            files.append(str(p))
        if gu.get("pipeline_b_json_text"):
            p = out_dir / f"gu_{gid}_pipeline_B_json.txt"
            p.write_text(gu["pipeline_b_json_text"], encoding="utf-8")
            files.append(str(p))
        if not gu.get("pipeline_b_zh") and not gu.get("pipeline_b_json_text") and gu.get("pipeline_b_video"):
            # legacy v3.0/3.1：合并文本另存一份
            p = out_dir / f"gu_{gid}_pipeline_B_video.txt"
            p.write_text(gu["pipeline_b_video"], encoding="utf-8")
            files.append(str(p))
        if gu.get("cli_payload"):
            p = out_dir / f"gu_{gid}_dreamina.json"
            p.write_text(json.dumps(gu["cli_payload"], ensure_ascii=False, indent=2), encoding="utf-8")
            files.append(str(p))
            cli_count += 1
    return {"gu_count": len(gus), "files": files, "cli_payload_count": cli_count}
