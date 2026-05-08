"""
Storyboard 复刻引擎 — pipeline 核心函数。

从用户工程 storyboard_engine_v3 的 scripts/run_pipeline.py 提取出来，
转成 Web 集成友好的 importable 接口（不依赖 argparse / sys.path / 文件系统副作用）。

两个核心函数：
- render_master_prompt(brand_config_block) → 渲染主提示词文本
- parse_llm_output(llm_output) → 拆出 N 个 GU 的双产线提示词包（list of dict）
"""
import re
from pathlib import Path
from typing import Optional

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
PIPELINE_B_PATTERN = re.compile(r"\[产线\s*B\].*?(?=──+\s*\(C\)|═+\s*【GU\d+\s*/|$)", re.DOTALL)


def parse_llm_output(llm_output: str) -> list[dict]:
    """从 LLM 完整输出里抓出每个 GU 的双产线提示词块。

    返回 list[dict]，每个 dict 形如：
        {
            "gu_id": "01",
            "full": "...",
            "pipeline_a_image": "...",  # 可能为 None
            "pipeline_b_video": "...",  # 可能为 None
        }
    """
    if not llm_output:
        return []

    blocks = GU_SPLIT_PATTERN.split(llm_output)
    result = []
    for block in blocks:
        m = GU_ID_PATTERN.search(block)
        if not m:
            continue
        gu_id = m.group(1).zfill(2)

        a_match = PIPELINE_A_PATTERN.search(block)
        b_match = PIPELINE_B_PATTERN.search(block)

        result.append({
            "gu_id": gu_id,
            "full": block.strip(),
            "pipeline_a_image": a_match.group(0).strip() if a_match else None,
            "pipeline_b_video": b_match.group(0).strip() if b_match else None,
        })
    return result


# ─────────────────────────────────────────────────────────────────────
# 3. 把解析结果落盘（per-GU 多文件，便于直接下载/复制粘贴）
# ─────────────────────────────────────────────────────────────────────
def save_gus_to_dir(gus: list[dict], out_dir: Path) -> dict:
    """把 parse_llm_output 的结果分文件写到 out_dir。

    返回 {"gu_count": N, "files": [...]}
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
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
    return {"gu_count": len(gus), "files": files}
