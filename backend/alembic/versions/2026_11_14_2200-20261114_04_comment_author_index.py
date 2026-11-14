"""shared item comments: index the author for account deletion

Revision ID: 20261114_04
Revises: 20261114_03
Create Date: 2026-11-14 22:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261114_04"
down_revision: str | Sequence[str] | None = "20261114_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        op.f("ix_shared_item_comments_author_id"), "shared_item_comments", ["author_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_shared_item_comments_author_id"), table_name="shared_item_comments")
