"""add_api_call_log

Revision ID: b7c91e2f4d10
Revises: a1b2c3d4e5f6
Create Date: 2026-05-08 03:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c91e2f4d10'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'api_call_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('task_id', sa.String(), sa.ForeignKey('tasks.id'), nullable=True),
        sa.Column('group_id', sa.String(), sa.ForeignKey('task_groups.id'), nullable=True),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('model', sa.String(), nullable=False),
        sa.Column('task_type', sa.String(), nullable=True),
        sa.Column('holo_task_id', sa.String(), nullable=True),
        sa.Column('cost', sa.Integer(), nullable=True),
        sa.Column('refunded', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('error_msg', sa.Text(), nullable=True),
        sa.Column('request_summary', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_api_call_log_id', 'api_call_log', ['id'])
    op.create_index('ix_api_call_log_user_id', 'api_call_log', ['user_id'])
    op.create_index('ix_api_call_log_task_id', 'api_call_log', ['task_id'])
    op.create_index('ix_api_call_log_group_id', 'api_call_log', ['group_id'])
    op.create_index('ix_api_call_log_provider', 'api_call_log', ['provider'])
    op.create_index('ix_api_call_log_holo_task_id', 'api_call_log', ['holo_task_id'])
    op.create_index('ix_api_call_log_status', 'api_call_log', ['status'])
    op.create_index('ix_api_call_log_created_at', 'api_call_log', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_api_call_log_created_at', table_name='api_call_log')
    op.drop_index('ix_api_call_log_status', table_name='api_call_log')
    op.drop_index('ix_api_call_log_holo_task_id', table_name='api_call_log')
    op.drop_index('ix_api_call_log_provider', table_name='api_call_log')
    op.drop_index('ix_api_call_log_group_id', table_name='api_call_log')
    op.drop_index('ix_api_call_log_task_id', table_name='api_call_log')
    op.drop_index('ix_api_call_log_user_id', table_name='api_call_log')
    op.drop_index('ix_api_call_log_id', table_name='api_call_log')
    op.drop_table('api_call_log')
