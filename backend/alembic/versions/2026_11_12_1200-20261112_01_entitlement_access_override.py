"""entitlements: access state chosen by an admin, separate from the RevenueCat status

Revision ID: 20261112_01
Revises: 20261111_01
Create Date: 2026-11-12 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261112_01"
down_revision: str | Sequence[str] | None = "20261111_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("entitlements", sa.Column("access_override", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("entitlements", "access_override")
