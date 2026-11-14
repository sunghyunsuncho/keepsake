"""shared albums: comments on photos

Revision ID: 20261114_01
Revises: 20261113_02
Create Date: 2026-11-14 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261114_01"
down_revision: str | Sequence[str] | None = "20261113_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_item_comments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("album_id", sa.String(length=36), nullable=False),
        sa.Column("item_id", sa.String(length=36), nullable=False),
        sa.Column("author_id", sa.String(length=36), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["album_id"], ["shared_albums.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["shared_album_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_shared_item_comments_item", "shared_item_comments", ["item_id", "created_at"]
    )
    op.create_index(op.f("ix_shared_item_comments_album_id"), "shared_item_comments", ["album_id"])
    op.add_column("content_reports", sa.Column("comment_id", sa.String(length=36), nullable=True))
    op.add_column("content_reports", sa.Column("comment_body", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("content_reports", "comment_body")
    op.drop_column("content_reports", "comment_id")
    op.drop_index(op.f("ix_shared_item_comments_album_id"), table_name="shared_item_comments")
    op.drop_index("ix_shared_item_comments_item", table_name="shared_item_comments")
    op.drop_table("shared_item_comments")
