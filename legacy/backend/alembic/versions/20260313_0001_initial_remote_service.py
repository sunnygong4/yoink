"""initial remote service schema"""

from alembic import op
import sqlalchemy as sa


revision = "20260313_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)

    op.create_table(
        "download_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("media_file_id", sa.Integer(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("mode", sa.String(), nullable=False),
        sa.Column("audio_bitrate_kbps", sa.Integer(), nullable=True),
        sa.Column("video_quality", sa.String(), nullable=True),
        sa.Column("allow_playlist", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("progress_percent", sa.Integer(), nullable=False),
        sa.Column("progress_message", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_download_jobs_id"), "download_jobs", ["id"], unique=False)
    op.create_index(op.f("ix_download_jobs_mode"), "download_jobs", ["mode"], unique=False)
    op.create_index(op.f("ix_download_jobs_owner_id"), "download_jobs", ["owner_id"], unique=False)
    op.create_index(op.f("ix_download_jobs_status"), "download_jobs", ["status"], unique=False)

    op.create_table(
        "media_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=True),
        sa.Column("media_type", sa.String(), nullable=False),
        sa.Column("relative_path", sa.String(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_site", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("uploader", sa.String(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["download_jobs.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_media_files_id"), "media_files", ["id"], unique=False)
    op.create_index(op.f("ix_media_files_job_id"), "media_files", ["job_id"], unique=False)
    op.create_index(op.f("ix_media_files_media_type"), "media_files", ["media_type"], unique=False)
    op.create_index(op.f("ix_media_files_owner_id"), "media_files", ["owner_id"], unique=False)
    op.create_index(op.f("ix_media_files_source_site"), "media_files", ["source_site"], unique=False)
    op.create_index(op.f("ix_media_files_title"), "media_files", ["title"], unique=False)
    op.create_index(op.f("ix_media_files_uploader"), "media_files", ["uploader"], unique=False)

    if op.get_bind().dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_download_jobs_media_file_id_media_files",
            "download_jobs",
            "media_files",
            ["media_file_id"],
            ["id"],
        )


def downgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint("fk_download_jobs_media_file_id_media_files", "download_jobs", type_="foreignkey")
    op.drop_index(op.f("ix_media_files_uploader"), table_name="media_files")
    op.drop_index(op.f("ix_media_files_title"), table_name="media_files")
    op.drop_index(op.f("ix_media_files_source_site"), table_name="media_files")
    op.drop_index(op.f("ix_media_files_owner_id"), table_name="media_files")
    op.drop_index(op.f("ix_media_files_media_type"), table_name="media_files")
    op.drop_index(op.f("ix_media_files_job_id"), table_name="media_files")
    op.drop_index(op.f("ix_media_files_id"), table_name="media_files")
    op.drop_table("media_files")
    op.drop_index(op.f("ix_download_jobs_status"), table_name="download_jobs")
    op.drop_index(op.f("ix_download_jobs_owner_id"), table_name="download_jobs")
    op.drop_index(op.f("ix_download_jobs_mode"), table_name="download_jobs")
    op.drop_index(op.f("ix_download_jobs_id"), table_name="download_jobs")
    op.drop_table("download_jobs")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
