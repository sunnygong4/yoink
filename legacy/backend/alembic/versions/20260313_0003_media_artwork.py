"""add media artwork sidecar path"""

from alembic import op
import sqlalchemy as sa


revision = "20260313_0003"
down_revision = "20260313_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_files", sa.Column("artwork_relative_path", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("media_files", "artwork_relative_path")
