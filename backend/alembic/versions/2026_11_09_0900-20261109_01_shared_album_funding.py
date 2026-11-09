"""shared albums: index unfunded albums and remember when members were told

Revision ID: 20261109_01
Revises: 20261108_03
Create Date: 2026-11-09 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261109_01"
down_revision: str | Sequence[str] | None = "20261108_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "shared_albums",
        sa.Column("unfunded_notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(op.f("ix_shared_albums_unfunded_since"), "shared_albums", ["unfunded_since"])
    # 이전 작업은 표시와 알림을 한 번에 했다. 이미 표시된 앨범은 알린 것으로 본다.
    op.execute(
        "UPDATE shared_albums SET unfunded_notified_at = unfunded_since "
        "WHERE unfunded_since IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_shared_albums_unfunded_since"), table_name="shared_albums")
    op.drop_column("shared_albums", "unfunded_notified_at")
