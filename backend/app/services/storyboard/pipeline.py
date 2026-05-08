"""
Storyboard 复刻引擎 — pipeline 核心函数。

从用户工程 storyboard_engine_v3 的 scripts/run_pipeline.py 提取出来，
转成 Web 集成友好的 importable 接口（不依赖 argparse / sys.path / 文件系统副作用）。

核心函数：
- render_master_prompt(brand_config_block) → 渲染主提示词文本
- parse_llm_output(llm_output) → 拆出 N 个 GU 的双产线提示词包 + (B9) Dreamina CLI JSON
- extract_summary_cli_payload(llm_output) → 抽末尾 ===CLI_PAYLOAD=== 包裹的汇总 JSON 数组

dual-output 模板（v3.1 升级，2026-05）：每个 GU 多一段 (B9) ```json``` 块用于 Dreamina CLI；
末尾再来一段 ===CLI_PAYLOAD=== 汇总，前后端解析时优先 trust 末尾的 summary（更不易被 LLM 偷懒漏字段）。
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
GU_SPLIT_PATTERN = re.compile(r"(?=═+\s*【GU\d+\s*/)")
GU_ID_PATTERN = re.compile(r"【GU(\d+)\s*/")
PIPELINE_A_PATTERN = re.compile(r"\[产线\s*A\].*?(?=\[产线\s*B\])", re.DOTALL)
PIPELINE_B_PATTERN = re.compile(
    # B 段一直延伸到 (B9) / (C) / 下一个 GU / 文末，保留 (B9) 块在 pipeline_b_video 文本里
    r"\[产线\s*B\].*?(?=──+\s*\(C\)|═+\s*【GU\d+\s*/|$)",
    re.DOTALL,
)
# (B9) JSON 块：```json {...} ``` —— 在每个 GU block 内匹配
B9_JSON_PATTERN = re.compile(
    r"\(B9\)[\s\S]*?```json\s*(\{[\s\S]*?\})\s*```",
    re.IGNORECASE,
)
# 末尾汇总：===CLI_PAYLOAD=== ... ===CLI_PAYLOAD_END===
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
        b_match = PIPELINE_B_PATTERN.search(block)

        # inline (B9) JSON
        cli_payload: Optional[dict] = None
        b9 = B9_JSON_PATTERN.search(block)
        if b9:
            parsed = _safe_parse_json(b9.group(1))
            if isinstance(parsed, dict):
                cli_payload = parsed

        # summary override（汇总通常更可靠，覆盖 inline）
        if gu_id in summary_by_id:
            cli_payload = summary_by_id[gu_id]

        # 兜底：补全缺失字段
        if cli_payload is not None:
            cli_payload.setdefault("gu_id", gu_id)
            cli_payload.setdefault("model_version", "seedance2.0fast")
            cli_payload.setdefault("duration", 15)
            cli_payload.setdefault("video_resolution", "720p")
            cli_payload.setdefault("ratio", "9:16")

        result.append({
            "gu_id": gu_id,
            "full": block.strip(),
            "pipeline_a_image": a_match.group(0).strip() if a_match else None,
            "pipeline_b_video": b_match.group(0).strip() if b_match else None,
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
        if gu.get("pipeline_b_video"):
            p = out_dir / f"gu_{gid}_pipeline_B_video.txt"
            p.write_text(gu["pipeline_b_video"], encoding="utf-8")
            files.append(str(p))
        if gu.get("cli_payload"):
            p = out_dir / f"gu_{gid}_dreamina.json"
            p.write_text(json.dumps(gu["cli_payload"], ensure_ascii=False, indent=2), encoding="utf-8")
            files.append(str(p))
            cli_count += 1
    return {"gu_count": len(gus), "files": files, "cli_payload_count": cli_count}
