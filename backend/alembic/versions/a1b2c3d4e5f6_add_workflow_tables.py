"""add_workflow_tables

Revision ID: a1b2c3d4e5f6
Revises: fd1abc850b51
Create Date: 2026-04-17 02:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'a3c8f072e901'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 工作流模板表
    op.create_table(
        'workflows',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('steps_json', sa.JSON(), nullable=False),
        sa.Column('input_schema', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    # 工作流执行实例表
    op.create_table(
        'workflow_runs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('workflow_id', sa.String(), sa.ForeignKey('workflows.id'), nullable=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('title', sa.String(), nullable=True),
        sa.Column('status', sa.Enum('draft', 'running', 'paused', 'completed', 'failed', name='workflowrunstatus'), nullable=False, server_default='draft'),
        sa.Column('current_step', sa.Integer(), server_default='0'),
        sa.Column('steps_state', sa.JSON(), nullable=True),
        sa.Column('input_files', sa.JSON(), nullable=True),
        sa.Column('input_prompts', sa.JSON(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    # task_groups 新增工作流关联字段
    op.add_column('task_groups', sa.Column('workflow_run_id', sa.String(), sa.ForeignKey('workflow_runs.id'), nullable=True))
    op.add_column('task_groups', sa.Column('workflow_step_index', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('task_groups', 'workflow_step_index')
    op.drop_column('task_groups', 'workflow_run_id')
    op.drop_table('workflow_runs')
    op.drop_table('workflows')
    sa.Enum(name='workflowrunstatus').drop(op.get_bind(), checkfirst=True)
