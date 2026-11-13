"""entitlements: split the single cloud plan into 10GB and 100GB plans

Revision ID: 20261113_01
Revises: 20261112_01
Create Date: 2026-11-13 12:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261113_01"
down_revision: str | Sequence[str] | None = "20261112_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 결제를 연결하기 전이라 실제 구독은 없다. 관리자 무상 제공 계정은 plan과 관계없이 100GB를 쓴다.
    op.execute("UPDATE entitlements SET plan = 'cloud_10gb' WHERE plan = 'cloud'")


def downgrade() -> None:
    op.execute("UPDATE entitlements SET plan = 'cloud' WHERE plan IN ('cloud_10gb', 'cloud_100gb')")
