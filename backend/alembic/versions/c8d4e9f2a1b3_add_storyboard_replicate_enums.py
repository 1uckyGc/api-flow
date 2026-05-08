"""add_storyboard_replicate_enums

Revision ID: c8d4e9f2a1b3
Revises: b7c91e2f4d10
Create Date: 2026-05-09 00:00:00.000000

加 TaskSource.STORYBOARD + GroupStatus.AWAITING_LLM_INPUT，给"复刻视频" /replicate 用。
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c8d4e9f2a1b3'
down_revision: Union[str, None] = 'b7c91e2f4d10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tasksource ADD VALUE IF NOT EXISTS 'STORYBOARD'")
        op.execute("ALTER TYPE groupstatus ADD VALUE IF NOT EXISTS 'awaiting_llm_input'")


def downgrade() -> None:
    pass
