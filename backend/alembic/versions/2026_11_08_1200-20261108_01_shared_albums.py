"""shared albums: members, invites and items that point at the uploader's moments

Revision ID: 20261108_01
Revises: 20261103_01
Create Date: 2026-11-08 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261108_01"
down_revision: str | Sequence[str] | None = "20261103_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shared_albums",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=80), nullable=False),
        sa.Column("relation", sa.String(length=16), nullable=False),
        sa.Column("photo_quality", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("item_seq", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "shared_album_members",
        sa.Column("album_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("display_name", sa.String(length=40), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["album_id"], ["shared_albums.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("album_id", "user_id"),
    )
    op.create_index(op.f("ix_shared_album_members_user_id"), "shared_album_members", ["user_id"])
    op.create_table(
        "shared_album_invites",
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("album_id", sa.String(length=36), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["album_id"], ["shared_albums.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("code"),
        sa.UniqueConstraint("album_id"),
    )
    op.create_table(
        "shared_album_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("album_id", sa.String(length=36), nullable=False),
        sa.Column("author_id", sa.String(length=36), nullable=False),
        sa.Column("moment_id", sa.String(length=36), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["album_id"], ["shared_albums.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["author_id", "moment_id"], ["moments.user_id", "moments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("album_id", "author_id", "moment_id", name="uq_shared_item_moment"),
    )
    op.create_index("ix_shared_items_album_seq", "shared_album_items", ["album_id", "seq"])
    op.create_index("ix_shared_items_author", "shared_album_items", ["author_id", "moment_id"])


def downgrade() -> None:
    op.drop_table("shared_album_items")
    op.drop_table("shared_album_invites")
    op.drop_index(op.f("ix_shared_album_members_user_id"), table_name="shared_album_members")
    op.drop_table("shared_album_members")
    op.drop_table("shared_albums")
