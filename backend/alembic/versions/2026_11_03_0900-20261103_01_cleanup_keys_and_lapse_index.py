"""storage cleanups hold whole object keys; index lapsed subscription lookup

Revision ID: 20261103_01
Revises: 20261102_02
Create Date: 2026-11-03 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261103_01"
down_revision: str | Sequence[str] | None = "20261102_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "storage_cleanups",
        "prefix",
        existing_type=sa.String(length=64),
        type_=sa.String(length=1024),
        existing_nullable=False,
    )
    op.create_index("ix_entitlements_status_expires", "entitlements", ["status", "expires_at"])
    op.drop_index(op.f("ix_entitlements_status"), table_name="entitlements")
    op.create_index(op.f("ix_billing_events_received_at"), "billing_events", ["received_at"])
    op.add_column("entitlements", sa.Column("notified_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("entitlements", "notified_at")
    op.drop_index(op.f("ix_billing_events_received_at"), table_name="billing_events")
    op.create_index(op.f("ix_entitlements_status"), "entitlements", ["status"])
    op.drop_index("ix_entitlements_status_expires", table_name="entitlements")
    # 업로드별 키는 예전 길이에 들어가지 않는다. 남은 객체는 계정 prefix 정리 때 함께 지워진다.
    op.execute("DELETE FROM storage_cleanups WHERE length(prefix) > 64")
    op.alter_column(
        "storage_cleanups",
        "prefix",
        existing_type=sa.String(length=1024),
        type_=sa.String(length=64),
        existing_nullable=False,
    )
