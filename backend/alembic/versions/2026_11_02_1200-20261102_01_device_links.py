"""device links between cloud moments and device photos

Revision ID: 20261102_01
Revises: 20261028_01
Create Date: 2026-11-02 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261102_01"
down_revision: str | Sequence[str] | None = "20261028_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_links",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column("moment_id", sa.String(length=36), nullable=False),
        sa.Column("asset_id", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id", "moment_id"], ["moments.user_id", "moments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "device_id", "moment_id"),
    )
    op.create_index(
        "ix_device_links_user_moment", "device_links", ["user_id", "moment_id"], unique=False
    )


def downgrade() -> None:
    op.drop_table("device_links")
