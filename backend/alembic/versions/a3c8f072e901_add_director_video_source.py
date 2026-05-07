"""add_director_video_source

Revision ID: a3c8f072e901
Revises: fd1abc850b51
Create Date: 2026-03-30 12:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3c8f072e901'
down_revision: Union[str, None] = 'e1aaab98a21f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tasksource ADD VALUE IF NOT EXISTS 'DIRECTOR_VIDEO'")


def downgrade() -> None:
    pass
