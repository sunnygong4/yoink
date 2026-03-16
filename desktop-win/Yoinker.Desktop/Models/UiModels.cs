using System.IO;
using Yoinker.Desktop.Services;

namespace Yoinker.Desktop.Models;

public sealed class DesktopSettings
{
    public string ServerUrl { get; set; } = "http://127.0.0.1:8000";
    public string Username { get; set; } = string.Empty;
    public string DownloadRoot { get; set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyMusic),
        "Yoinker");
    public string LastSection { get; set; } = "Home";
    public string Theme { get; set; } = "classic";
    public string? ProtectedToken { get; set; }
}

public sealed class OfflineTrackRecord
{
    public int MediaId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Artist { get; set; }
    public string? Album { get; set; }
    public string LocalPath { get; set; } = string.Empty;
    public string? ArtworkUrl { get; set; }
    public int? DurationSeconds { get; set; }
    public DateTimeOffset DownloadedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class HomeResultCard
{
    public CatalogSearchResult? Result { get; init; }
    public VersionGroupRead? VersionGroup { get; init; }
    public string? ArtworkOverrideUrl { get; init; }

    public string Title => VersionGroup?.DisplayTitle ?? Result?.Title ?? "Untitled";
    public string ArtistLine => VersionGroup?.DisplayArtist ?? Result?.Artist ?? "Unknown artist";
    public string MetaLine => VersionGroup is not null
        ? string.Join(" | ", new[]
        {
            $"{1 + (VersionGroup.AlternateVersions?.Count ?? 0)} version{((VersionGroup.AlternateVersions?.Count ?? 0) + 1 == 1 ? string.Empty : "s")}",
            VersionGroup.SelectedVersion?.Album,
        }.Where(value => !string.IsNullOrWhiteSpace(value)))
        : string.Join(" | ", new[] { Result?.Album, Result?.Year }.Where(value => !string.IsNullOrWhiteSpace(value)));
    public string? ArtworkUrl => ArtworkOverrideUrl ?? VersionGroup?.ArtworkUrl ?? Result?.ArtworkUrl;
    public bool IsVersionGroup => VersionGroup is not null;
    public bool IsAlbum => !IsVersionGroup && string.Equals(Result?.ResultType, "album", StringComparison.OrdinalIgnoreCase);
    public bool CanPreview => PrimaryVersion is not null;
    public string SourceLabel => PrimaryVersion?.Source?.ToUpperInvariant() ?? "CATALOG";
    public string ImportLabel => IsAlbum ? "Add Album" : IsVersionGroup ? "Choose Version" : "Add to Library";
    public DiscoverySearchResult? PrimaryVersion => VersionGroup?.SelectedVersion ?? Result?.BestMatch;
}

public sealed class LibraryTrackCard
{
    public required MediaFileRead Media { get; init; }
    public string? ArtworkUrl { get; init; }
    public bool IsDownloaded { get; init; }

    public string Title => Media.Title;
    public string Subtitle => string.Join(" | ", new[] { Media.Uploader, Media.Album }.Where(value => !string.IsNullOrWhiteSpace(value)));
    public string DurationLabel => UiFormat.Duration(Media.DurationSeconds);
    public string SourceLabel => string.IsNullOrWhiteSpace(Media.SourceSite) ? "SERVER" : Media.SourceSite.ToUpperInvariant();
    public string LocalStateLabel => IsDownloaded ? "Downloaded on this PC" : "Stream from server";
}

public sealed class AlbumCard
{
    public required AlbumGroupRead Album { get; init; }
    public string? ArtworkUrl { get; init; }
    public int DownloadedTracks { get; init; }

    public string Title => Album.Title;
    public string Artist => Album.Artist ?? "Unknown artist";
    public string MetaLine => $"{Album.TrackCount} tracks | {UiFormat.Duration(Album.TotalDurationSeconds)}";
    public string LocalStateLabel => DownloadedTracks == 0 ? "Stream only" : $"{DownloadedTracks}/{Album.TrackCount} saved offline";
    public string TrackPreview => string.Join(", ", Album.Items.Take(4).Select(item => item.Title));
}

public sealed class OfflineTrackCard
{
    public required OfflineTrackRecord Item { get; init; }

    public string Title => Item.Title;
    public string Subtitle => string.Join(" | ", new[] { Item.Artist, Item.Album }.Where(value => !string.IsNullOrWhiteSpace(value)));
    public string DurationLabel => UiFormat.Duration(Item.DurationSeconds);
    public string DownloadedLabel => $"Saved {Item.DownloadedAt.LocalDateTime:g}";
    public string? ArtworkUrl => Item.ArtworkUrl;
}

public sealed class DiscoveryResultCard
{
    public required DiscoverySearchResult Result { get; init; }
    public string? ArtworkUrl { get; init; }

    public string Title => Result.Title;
    public string Subtitle => string.Join(" | ", new[] { Result.Artist, Result.Album }.Where(value => !string.IsNullOrWhiteSpace(value)));
    public string SourceLabel => Result.Source.ToUpperInvariant();
    public string DurationLabel => UiFormat.Duration(Result.DurationSeconds);
}

public sealed class JobCard
{
    public required DownloadJobRead Job { get; init; }

    public string Title => Job.MediaFileId is { } mediaId ? $"Media #{mediaId}" : Job.SourceUrl;
    public string StatusLabel => $"{Job.Status.ToUpperInvariant()} | {Job.ProgressPercent}%";
    public string Detail => Job.ErrorMessage ?? Job.ProgressMessage ?? string.Empty;
}

public sealed class PlaybackEntry
{
    public int? MediaId { get; init; }
    public string Title { get; init; } = string.Empty;
    public string Subtitle { get; init; } = string.Empty;
    public string SourceUri { get; init; } = string.Empty;
    public bool IsLocalFile { get; init; }
    public string? ArtworkUrl { get; init; }
}
