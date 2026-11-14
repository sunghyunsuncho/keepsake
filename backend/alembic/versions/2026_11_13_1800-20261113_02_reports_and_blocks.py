"""shared albums: content reports and user blocks

Revision ID: 20261113_02
Revises: 20261113_01
Create Date: 2026-11-13 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261113_02"
down_revision: str | Sequence[str] | None = "20261113_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_blocks",
        sa.Column("blocker_id", sa.String(length=36), nullable=False),
        sa.Column("blocked_id", sa.String(length=36), nullable=False),
        sa.Column("display_name", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["blocker_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocked_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("blocker_id", "blocked_id"),
    )
    op.create_table(
        "content_reports",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("reporter_id", sa.String(length=36), nullable=True),
        sa.Column("album_id", sa.String(length=36), nullable=False),
        sa.Column("album_title", sa.String(length=80), nullable=False),
        sa.Column("reported_user_id", sa.String(length=36), nullable=False),
        sa.Column("reported_name", sa.String(length=40), nullable=True),
        sa.Column("item_id", sa.String(length=36), nullable=True),
        sa.Column("moment_id", sa.String(length=36), nullable=True),
        sa.Column("reason", sa.String(length=16), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_content_reports_status_created", "content_reports", ["status", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_content_reports_status_created", table_name="content_reports")
    op.drop_table("content_reports")
    op.drop_table("user_blocks")
