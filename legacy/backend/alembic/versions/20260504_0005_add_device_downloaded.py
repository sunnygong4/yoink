"""add device downloaded flag to jobs"""

from alembic import op
import sqlalchemy as sa


revision = "20260504_0005"
down_revision = "20260313_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "download_jobs",
        sa.Column("device_downloaded", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("download_jobs", "device_downloaded")
