"""shared album items: retain capture coordinates for downloaded efficient JPEGs

Revision ID: 20261111_01
Revises: 20261109_03
Create Date: 2026-11-11 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261111_01"
down_revision: str | Sequence[str] | None = "20261109_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shared_album_items", sa.Column("lat", sa.Float(), nullable=True))
    op.add_column("shared_album_items", sa.Column("lng", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("shared_album_items", "lng")
    op.drop_column("shared_album_items", "lat")
