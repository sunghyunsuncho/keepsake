"""cache shared album usage: item bytes, album totals, shared bytes per moment and user

Revision ID: 20261108_03
Revises: 20261108_02
Create Date: 2026-11-08 21:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261108_03"
down_revision: str | Sequence[str] | None = "20261108_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "shared_album_items",
        sa.Column("bytes", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.add_column(
        "shared_albums",
        sa.Column("bytes_total", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.add_column(
        "shared_albums", sa.Column("unfunded_since", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "usage", sa.Column("shared_bytes", sa.BigInteger(), nullable=False, server_default="0")
    )
    op.create_table(
        "shared_moments",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("moment_id", sa.String(length=36), nullable=False),
        sa.Column("bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "moment_id"),
    )
    # 이미 있는 항목의 값은 0에서 시작한다. 배포 뒤 한 번 `python -m app.jobs reconcile`로 채운다
    # (매일 새벽 주기 작업도 같은 일을 한다).


def downgrade() -> None:
    op.drop_table("shared_moments")
    op.drop_column("usage", "shared_bytes")
    op.drop_column("shared_albums", "unfunded_since")
    op.drop_column("shared_albums", "bytes_total")
    op.drop_column("shared_album_items", "bytes")
