"""devices: app language for server-made notifications

Revision ID: 20261114_02
Revises: 20261114_01
Create Date: 2026-11-14 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261114_02"
down_revision: str | Sequence[str] | None = "20261114_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column("language", sa.String(length=8), server_default="ko", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("devices", "language")
