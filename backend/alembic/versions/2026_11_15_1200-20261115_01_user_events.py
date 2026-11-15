"""user_events: key actions of signed-in users for activity analysis

Revision ID: 20261115_01
Revises: 20261114_04
Create Date: 2026-11-15 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261115_01"
down_revision: str | Sequence[str] | None = "20261114_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=48), nullable=False),
        sa.Column("entity_ref", sa.String(length=120), nullable=True),
        sa.Column("properties", sa.JSON(), nullable=True),
        sa.Column("platform", sa.String(length=16), nullable=True),
        sa.Column("app_version", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_events_created_at"), "user_events", ["created_at"])
    op.create_index("ix_user_events_user_created", "user_events", ["user_id", "created_at"])
    op.create_index("ix_user_events_type_created", "user_events", ["event_type", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_user_events_type_created", table_name="user_events")
    op.drop_index("ix_user_events_user_created", table_name="user_events")
    op.drop_index(op.f("ix_user_events_created_at"), table_name="user_events")
    op.drop_table("user_events")
