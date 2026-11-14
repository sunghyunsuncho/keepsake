"""shared albums: caption that the uploader shows to members

Revision ID: 20261114_03
Revises: 20261114_02
Create Date: 2026-11-14 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261114_03"
down_revision: str | Sequence[str] | None = "20261114_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shared_album_items", sa.Column("caption", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("shared_album_items", "caption")
