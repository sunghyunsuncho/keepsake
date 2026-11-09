"""shared albums: choose a cover (latest photo, a chosen photo, or an emoji design)

Revision ID: 20261109_02
Revises: 20261109_01
Create Date: 2026-11-09 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261109_02"
down_revision: str | Sequence[str] | None = "20261109_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "shared_albums",
        sa.Column("cover_mode", sa.String(16), nullable=False, server_default="latest"),
    )
    op.add_column("shared_albums", sa.Column("cover_item_id", sa.String(36), nullable=True))
    op.add_column("shared_albums", sa.Column("cover_emoji", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("shared_albums", "cover_emoji")
    op.drop_column("shared_albums", "cover_item_id")
    op.drop_column("shared_albums", "cover_mode")
