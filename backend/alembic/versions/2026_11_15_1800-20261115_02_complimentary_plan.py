"""entitlements: complimentary access names the plan it grants (10GB or 100GB)

Revision ID: 20261115_02
Revises: 20261115_01
Create Date: 2026-11-15 18:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261115_02"
down_revision: str | Sequence[str] | None = "20261115_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 지금까지 무상 제공은 100GB였다.
    op.execute(
        "UPDATE entitlements SET access_override = 'cloud_100gb' WHERE access_override = 'cloud'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE entitlements SET access_override = 'cloud' "
        "WHERE access_override IN ('cloud_10gb', 'cloud_100gb')"
    )
