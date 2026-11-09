"""shared albums: choose the storage quality of each photo

Revision ID: 20261109_03
Revises: 20261109_02
Create Date: 2026-11-09 15:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261109_03"
down_revision: str | Sequence[str] | None = "20261109_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("shared_album_items", sa.Column("photo_quality", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("shared_album_items", "photo_quality")
