using System.Text.Json.Serialization;

namespace Yoinker.Desktop.Models;

public sealed class AuthTokenResponse
{
    [JsonPropertyName("access_token")]
    public string AccessToken { get; set; } = string.Empty;
}

public sealed class UserRead
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;
}

public sealed class MetadataOverrideRequestDto
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("album")]
    public string? Album { get; set; }

    [JsonPropertyName("artwork_url")]
    public string? ArtworkUrl { get; set; }
}

public sealed class DiscoverySearchResult
{
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    [JsonPropertyName("provider_id")]
    public string ProviderId { get; set; } = string.Empty;

    [JsonPropertyName("canonical_source_url")]
    public string CanonicalSourceUrl { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("album")]
    public string? Album { get; set; }

    [JsonPropertyName("duration_seconds")]
    public int? DurationSeconds { get; set; }

    [JsonPropertyName("artwork_url")]
    public string? ArtworkUrl { get; set; }
}

public sealed class DiscoverySearchPage
{
    [JsonPropertyName("query")]
    public string Query { get; set; } = string.Empty;

    [JsonPropertyName("sources")]
    public List<string> Sources { get; set; } = [];

    [JsonPropertyName("items")]
    public List<DiscoverySearchResult> Items { get; set; } = [];

    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("page_size")]
    public int PageSize { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }
}

public sealed class VersionGroupRead
{
    [JsonPropertyName("group_id")]
    public string GroupId { get; set; } = string.Empty;

    [JsonPropertyName("display_title")]
    public string DisplayTitle { get; set; } = string.Empty;

    [JsonPropertyName("display_artist")]
    public string? DisplayArtist { get; set; }

    [JsonPropertyName("artwork_url")]
    public string? ArtworkUrl { get; set; }

    [JsonPropertyName("confidence")]
    public double Confidence { get; set; }

    [JsonPropertyName("selected_version")]
    public DiscoverySearchResult SelectedVersion { get; set; } = new();

    [JsonPropertyName("alternate_versions")]
    public List<DiscoverySearchResult> AlternateVersions { get; set; } = [];
}

public sealed class VersionSearchPage
{
    [JsonPropertyName("query")]
    public string Query { get; set; } = string.Empty;

    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = "ok";

    [JsonPropertyName("items")]
    public List<VersionGroupRead> Items { get; set; } = [];

    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("page_size")]
    public int PageSize { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }
}

public sealed class DiscoveryStreamSessionRead
{
    [JsonPropertyName("session_token")]
    public string SessionToken { get; set; } = string.Empty;

    [JsonPropertyName("expires_at")]
    public DateTimeOffset ExpiresAt { get; set; }

    [JsonPropertyName("stream_url")]
    public string StreamUrl { get; set; } = string.Empty;

    [JsonPropertyName("item")]
    public DiscoverySearchResult Item { get; set; } = new();
}

public sealed class DiscoveryStreamSessionRequestDto
{
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    [JsonPropertyName("canonical_source_url")]
    public string CanonicalSourceUrl { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("album")]
    public string? Album { get; set; }

    [JsonPropertyName("duration_seconds")]
    public int? DurationSeconds { get; set; }

    [JsonPropertyName("artwork_url")]
    public string? ArtworkUrl { get; set; }

    [JsonPropertyName("provider_id")]
    public string ProviderId { get; set; } = string.Empty;
}

public sealed class DiscoveryImportRequestDto
{
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    [JsonPropertyName("canonical_source_url")]
    public string CanonicalSourceUrl { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("album")]
    public string? Album { get; set; }

    [JsonPropertyName("duration_seconds")]
    public int? DurationSeconds { get; set; }

    [JsonPropertyName("artwork_url")]
    public string? ArtworkUrl { get; set; }

    [JsonPropertyName("provider_id")]
    public string ProviderId { get; set; } = string.Empty;

    [JsonPropertyName("metadata_overrides")]
    public MetadataOverrideRequestDto? MetadataOverrides { get; set; }

    [JsonPropertyName("enrich_metadata")]
    public bool EnrichMetadata { get; set; } = true;

    [JsonPropertyName("download_to_device")]
    public bool DownloadToDevice { get; set; }

    [JsonPropertyName("audio_bitrate_kbps")]
    public int? AudioBitrateKbps { get; set; } = 192;
}

public sealed class CatalogSearchResult
{
    [JsonPropertyName("result_type")]
    public string ResultType { get; set; } = string.Empty;

    [JsonPropertyName("catalog_id")]
    public string CatalogId { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("album")]
    public string? Album { get; set; }

    [JsonPropertyName("year")]
    public string? Year { get; set; }

    [JsonPropertyName("track_count")]
    public int? TrackCount { get; set; }

    [JsonPropertyName("artwork_url")]
    public string? ArtworkUrl { get; set; }

    [JsonPropertyName("best_match")]
    public DiscoverySearchResult? BestMatch { get; set; }

    [JsonPropertyName("alternate_matches")]
    public List<DiscoverySearchResult> AlternateMatches { get; set; } = [];
}

public sealed class CatalogSearchPage
{
    [JsonPropertyName("query")]
    public string Query { get; set; } = string.Empty;

    [JsonPropertyName("secondary_query")]
    public string? SecondaryQuery { get; set; }

    [JsonPropertyName("search_type")]
    public string SearchType { get; set; } = string.Empty;

    [JsonPropertyName("items")]
    public List<CatalogSearchResult> Items { get; set; } = [];

    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("page_size")]
    public int PageSize { get; set; }

    [JsonPropertyName("total")]
    public int Total { get; set; }
}

public sealed class CatalogTrackImportRequestDto
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("album")]
    public string? Album { get; set; }

    [JsonPropertyName("artwork_url")]
    public string? ArtworkUrl { get; set; }

    [JsonPropertyName("preferred_match")]
    public DiscoveryImportRequestDto? PreferredMatch { get; set; }

    [JsonPropertyName("audio_bitrate_kbps")]
    public int? AudioBitrateKbps { get; set; } = 192;

    [JsonPropertyName("enrich_metadata")]
    public bool EnrichMetadata { get; set; } = true;

    [JsonPropertyName("download_to_device")]
    public bool DownloadToDevice { get; set; }
}

public sealed class CatalogAlbumImportRequestDto
{
    [JsonPropertyName("release_id")]
    public string ReleaseId { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("artwork_url")]
    public string? ArtworkUrl { get; set; }

    [JsonPropertyName("audio_bitrate_kbps")]
    public int? AudioBitrateKbps { get; set; } = 192;

    [JsonPropertyName("enrich_metadata")]
    public bool EnrichMetadata { get; set; } = true;

    [JsonPropertyName("download_to_device")]
    public bool DownloadToDevice { get; set; }
}

public sealed class CatalogAlbumImportRead
{
    [JsonPropertyName("release_id")]
    public string ReleaseId { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("total_tracks")]
    public int TotalTracks { get; set; }

    [JsonPropertyName("queued_jobs")]
    public int QueuedJobs { get; set; }

    [JsonPropertyName("completed_jobs")]
    public int CompletedJobs { get; set; }

    [JsonPropertyName("unmatched_tracks")]
    public List<string> UnmatchedTracks { get; set; } = [];

    [JsonPropertyName("jobs")]
    public List<DownloadJobRead> Jobs { get; set; } = [];
}

public sealed class MediaFileRead
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("media_type")]
    public string MediaType { get; set; } = "audio";

    [JsonPropertyName("source_url")]
    public string SourceUrl { get; set; } = string.Empty;

    [JsonPropertyName("source_site")]
    public string SourceSite { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("uploader")]
    public string? Uploader { get; set; }

    [JsonPropertyName("album")]
    public string? Album { get; set; }

    [JsonPropertyName("metadata_status")]
    public string MetadataStatus { get; set; } = string.Empty;

    [JsonPropertyName("artwork_relative_path")]
    public string? ArtworkRelativePath { get; set; }

    [JsonPropertyName("size_bytes")]
    public long SizeBytes { get; set; }

    [JsonPropertyName("duration_seconds")]
    public int? DurationSeconds { get; set; }

    [JsonPropertyName("created_at")]
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class MediaLibraryPage
{
    [JsonPropertyName("items")]
    public List<MediaFileRead> Items { get; set; } = [];

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("page_size")]
    public int PageSize { get; set; }
}

public sealed class AlbumGroupRead
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("track_count")]
    public int TrackCount { get; set; }

    [JsonPropertyName("total_duration_seconds")]
    public int? TotalDurationSeconds { get; set; }

    [JsonPropertyName("artwork_media_id")]
    public int? ArtworkMediaId { get; set; }

    [JsonPropertyName("items")]
    public List<MediaFileRead> Items { get; set; } = [];
}

public sealed class DownloadJobRead
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("media_file_id")]
    public int? MediaFileId { get; set; }

    [JsonPropertyName("source_url")]
    public string SourceUrl { get; set; } = string.Empty;

    [JsonPropertyName("mode")]
    public string Mode { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("progress_percent")]
    public int ProgressPercent { get; set; }

    [JsonPropertyName("progress_message")]
    public string? ProgressMessage { get; set; }

    [JsonPropertyName("error_message")]
    public string? ErrorMessage { get; set; }

    [JsonPropertyName("created_at")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class UrlJobRequestDto
{
    [JsonPropertyName("url")]
    public string Url { get; set; } = string.Empty;

    [JsonPropertyName("mode")]
    public string Mode { get; set; } = "audio";

    [JsonPropertyName("audio_bitrate_kbps")]
    public int? AudioBitrateKbps { get; set; } = 192;

    [JsonPropertyName("video_quality")]
    public string? VideoQuality { get; set; } = "best";

    [JsonPropertyName("allow_playlist")]
    public bool AllowPlaylist { get; set; }

    [JsonPropertyName("metadata_overrides")]
    public MetadataOverrideRequestDto? MetadataOverrides { get; set; }
}
