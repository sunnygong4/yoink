"""add discovery import metadata fields"""

from alembic import op
import sqlalchemy as sa


revision = "20260313_0004"
down_revision = "20260313_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_files", sa.Column("album", sa.String(), nullable=True))
    op.add_column("media_files", sa.Column("raw_title", sa.String(), nullable=True))
    op.add_column("media_files", sa.Column("raw_uploader", sa.String(), nullable=True))
    op.add_column("media_files", sa.Column("raw_album", sa.String(), nullable=True))
    op.add_column("media_files", sa.Column("metadata_status", sa.String(), nullable=False, server_default="source"))
    op.create_index(op.f("ix_media_files_album"), "media_files", ["album"], unique=False)
    op.create_index(op.f("ix_media_files_metadata_status"), "media_files", ["metadata_status"], unique=False)

    op.add_column("download_jobs", sa.Column("import_source", sa.String(), nullable=True))
    op.add_column("download_jobs", sa.Column("metadata_overrides_json", sa.Text(), nullable=True))
    op.add_column("download_jobs", sa.Column("enrich_metadata", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("download_jobs", sa.Column("download_to_device", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index(op.f("ix_download_jobs_import_source"), "download_jobs", ["import_source"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_download_jobs_import_source"), table_name="download_jobs")
    op.drop_column("download_jobs", "download_to_device")
    op.drop_column("download_jobs", "enrich_metadata")
    op.drop_column("download_jobs", "metadata_overrides_json")
    op.drop_column("download_jobs", "import_source")

    op.drop_index(op.f("ix_media_files_metadata_status"), table_name="media_files")
    op.drop_index(op.f("ix_media_files_album"), table_name="media_files")
    op.drop_column("media_files", "metadata_status")
    op.drop_column("media_files", "raw_album")
    op.drop_column("media_files", "raw_uploader")
    op.drop_column("media_files", "raw_title")
    op.drop_column("media_files", "album")
