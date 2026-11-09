"""shared albums: owner, member allocations and item snapshots

Revision ID: 20261108_02
Revises: 20261108_01
Create Date: 2026-11-08 18:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261108_02"
down_revision: str | Sequence[str] | None = "20261108_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("shared_albums", sa.Column("owner_id", sa.String(length=36), nullable=True))
    op.create_foreign_key(
        "shared_albums_owner_id_fkey",
        "shared_albums",
        "users",
        ["owner_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_shared_albums_owner_id"), "shared_albums", ["owner_id"])
    op.add_column(
        "shared_albums",
        sa.Column("extra_bytes", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.add_column(
        "shared_album_members",
        sa.Column("allocated_bytes", sa.BigInteger(), nullable=False, server_default="0"),
    )
    # 이전에는 소유자와 할당이 없었다. 가장 먼저 참여한 관리자를 소유자로 두고,
    # 할당은 0에서 시작한다
    # (구성원이 앱에서 정한다).
    op.execute(
        """
        UPDATE shared_albums a SET owner_id = (
          SELECT m.user_id FROM shared_album_members m
          WHERE m.album_id = a.id AND m.role = 'admin'
          ORDER BY m.joined_at, m.user_id LIMIT 1
        )
        """
    )

    # 항목은 올린 사람이 기록을 지우거나 앨범을 나가도 남을 수 있다. 촬영 정보를 옮겨 둔다.
    op.drop_constraint(
        "shared_album_items_author_id_moment_id_fkey", "shared_album_items", type_="foreignkey"
    )
    op.add_column(
        "shared_album_items",
        sa.Column("media_type", sa.String(length=8), nullable=False, server_default="photo"),
    )
    op.add_column("shared_album_items", sa.Column("duration", sa.Float(), nullable=True))
    op.add_column("shared_album_items", sa.Column("taken_at", sa.String(length=40), nullable=True))
    for column in ("taken_tz_offset", "width", "height"):
        op.add_column("shared_album_items", sa.Column(column, sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE shared_album_items i SET
          media_type = CASE WHEN (m.data::json -> 'data' ->> 'media_type') = 'video'
                            THEN 'video' ELSE 'photo' END,
          taken_at = m.data::json -> 'data' ->> 'taken_at'
        FROM moments m WHERE m.user_id = i.author_id AND m.id = i.moment_id
        """
    )


def downgrade() -> None:
    for column in ("height", "width", "taken_tz_offset", "taken_at", "duration", "media_type"):
        op.drop_column("shared_album_items", column)
    op.execute(
        """
        DELETE FROM shared_album_items i WHERE NOT EXISTS (
          SELECT 1 FROM moments m WHERE m.user_id = i.author_id AND m.id = i.moment_id
        )
        """
    )
    op.create_foreign_key(
        "shared_album_items_author_id_moment_id_fkey",
        "shared_album_items",
        "moments",
        ["author_id", "moment_id"],
        ["user_id", "id"],
        ondelete="CASCADE",
    )
    op.drop_column("shared_album_members", "allocated_bytes")
    op.drop_column("shared_albums", "extra_bytes")
    op.drop_index(op.f("ix_shared_albums_owner_id"), table_name="shared_albums")
    op.drop_constraint("shared_albums_owner_id_fkey", "shared_albums", type_="foreignkey")
    op.drop_column("shared_albums", "owner_id")
