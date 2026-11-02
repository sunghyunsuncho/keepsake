"""storage cleanups for uploads that arrive after account deletion

Revision ID: 20261102_02
Revises: 20261102_01
Create Date: 2026-11-02 18:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261102_02"
down_revision: str | Sequence[str] | None = "20261102_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "storage_cleanups",
        sa.Column("prefix", sa.String(length=64), nullable=False),
        sa.Column("not_before", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("prefix"),
    )


def downgrade() -> None:
    op.drop_table("storage_cleanups")
