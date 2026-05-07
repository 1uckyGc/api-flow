"""add_director_storyboard_sources

Revision ID: fd1abc850b51
Revises: dfd9b1801179
Create Date: 2026-03-28 09:05:38.284756

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fd1abc850b51'
down_revision: Union[str, None] = 'dfd9b1801179'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 绕过 PostgreSQL 在事务块中不能执行 ALTER TYPE 的限制
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tasksource ADD VALUE IF NOT EXISTS 'DIRECTOR'")
        op.execute("ALTER TYPE tasksource ADD VALUE IF NOT EXISTS 'STORYBOARD_FISSION'")


def downgrade() -> None:
    # PostgreSQL 不支持简单删除 enum 值，在降级时一般留空或需要重建 type
    pass
