"""add playlists and radio channels"""

from alembic import op
import sqlalchemy as sa


revision = "20260313_0002"
down_revision = "20260313_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "playlists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("visibility", sa.String(), nullable=False),
        sa.Column("share_token", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_playlists_id"), "playlists", ["id"], unique=False)
    op.create_index(op.f("ix_playlists_owner_id"), "playlists", ["owner_id"], unique=False)
    op.create_index(op.f("ix_playlists_share_token"), "playlists", ["share_token"], unique=True)
    op.create_index(op.f("ix_playlists_title"), "playlists", ["title"], unique=False)
    op.create_index(op.f("ix_playlists_visibility"), "playlists", ["visibility"], unique=False)

    op.create_table(
        "playlist_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("playlist_id", sa.Integer(), nullable=False),
        sa.Column("media_file_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["media_file_id"], ["media_files.id"]),
        sa.ForeignKeyConstraint(["playlist_id"], ["playlists.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_playlist_items_id"), "playlist_items", ["id"], unique=False)
    op.create_index(op.f("ix_playlist_items_media_file_id"), "playlist_items", ["media_file_id"], unique=False)
    op.create_index(op.f("ix_playlist_items_playlist_id"), "playlist_items", ["playlist_id"], unique=False)

    op.create_table(
        "radio_channels",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("playlist_id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("share_token", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["playlist_id"], ["playlists.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_radio_channels_id"), "radio_channels", ["id"], unique=False)
    op.create_index(op.f("ix_radio_channels_owner_id"), "radio_channels", ["owner_id"], unique=False)
    op.create_index(op.f("ix_radio_channels_playlist_id"), "radio_channels", ["playlist_id"], unique=False)
    op.create_index(op.f("ix_radio_channels_share_token"), "radio_channels", ["share_token"], unique=True)
    op.create_index(op.f("ix_radio_channels_slug"), "radio_channels", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_radio_channels_slug"), table_name="radio_channels")
    op.drop_index(op.f("ix_radio_channels_share_token"), table_name="radio_channels")
    op.drop_index(op.f("ix_radio_channels_playlist_id"), table_name="radio_channels")
    op.drop_index(op.f("ix_radio_channels_owner_id"), table_name="radio_channels")
    op.drop_index(op.f("ix_radio_channels_id"), table_name="radio_channels")
    op.drop_table("radio_channels")
    op.drop_index(op.f("ix_playlist_items_playlist_id"), table_name="playlist_items")
    op.drop_index(op.f("ix_playlist_items_media_file_id"), table_name="playlist_items")
    op.drop_index(op.f("ix_playlist_items_id"), table_name="playlist_items")
    op.drop_table("playlist_items")
    op.drop_index(op.f("ix_playlists_visibility"), table_name="playlists")
    op.drop_index(op.f("ix_playlists_title"), table_name="playlists")
    op.drop_index(op.f("ix_playlists_share_token"), table_name="playlists")
    op.drop_index(op.f("ix_playlists_owner_id"), table_name="playlists")
    op.drop_index(op.f("ix_playlists_id"), table_name="playlists")
    op.drop_table("playlists")
