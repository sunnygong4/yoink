using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Yoinker.Desktop.Models;
using Yoinker.Desktop.Services;

namespace Yoinker.Desktop;

public partial class MainWindow : Window
{
    private readonly YoinkerApiClient _api = new();
    private readonly DesktopStateStore _state = new();
    private readonly ViewState _view = new();
    private readonly DispatcherTimer _timer;
    private readonly DispatcherTimer _jobsPollTimer;
    private readonly Dictionary<int, OfflineTrackRecord> _offline = new();
    private DesktopSettings _settings = new();
    private bool _connected;
    private bool _dragSeek;
    private bool _muteSeekEvent;
    private bool _playing;
    private bool _pollingJobs;
    private bool _suppressThemeSelection;
    private int _queueIndex = -1;

    private sealed record ThemePalette(
        string Window,
        string Sidebar,
        string Panel,
        string Card,
        string Border,
        string BorderStrong,
        string TextPrimary,
        string TextSecondary,
        string Accent,
        string AccentText,
        string Input,
        string NavButton,
        string SecondaryButton,
        string Player);

    private static readonly Dictionary<string, ThemePalette> ThemePalettes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["classic"] = new ThemePalette(
            Window: "#081512",
            Sidebar: "#0C1613",
            Panel: "#101917",
            Card: "#121D1A",
            Border: "#263A35",
            BorderStrong: "#20312D",
            TextPrimary: "#F3F8F6",
            TextSecondary: "#98B0A7",
            Accent: "#74E0B6",
            AccentText: "#08110D",
            Input: "#162320",
            NavButton: "#162320",
            SecondaryButton: "#162320",
            Player: "#0D1714"),
        ["dark"] = new ThemePalette(
            Window: "#06090F",
            Sidebar: "#0A1020",
            Panel: "#0E1423",
            Card: "#111B30",
            Border: "#223450",
            BorderStrong: "#1A2943",
            TextPrimary: "#EAF2FF",
            TextSecondary: "#A8B8D8",
            Accent: "#7BD2FF",
            AccentText: "#061320",
            Input: "#15213A",
            NavButton: "#17263F",
            SecondaryButton: "#17263F",
            Player: "#0B1220"),
        ["bright"] = new ThemePalette(
            Window: "#EEF4F1",
            Sidebar: "#E2ECE8",
            Panel: "#F6FBF9",
            Card: "#FFFFFF",
            Border: "#C7D9D1",
            BorderStrong: "#B1C9BF",
            TextPrimary: "#14211D",
            TextSecondary: "#4E655B",
            Accent: "#1FAF7F",
            AccentText: "#FFFFFF",
            Input: "#FFFFFF",
            NavButton: "#EDF6F2",
            SecondaryButton: "#EDF6F2",
            Player: "#E8F1ED"),
    };

    public MainWindow()
    {
        InitializeComponent();
        DataContext = _view;
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _timer.Tick += (_, _) => UpdatePlaybackProgress();
        _jobsPollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _jobsPollTimer.Tick += async (_, _) => await AutoRefreshJobsAsync();
    }

    private async Task Guard(Func<Task> task, string label)
    {
        try { await task(); }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Failed to {label}.\n\n{ex.Message}", "Yoinker Desktop", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private bool EnsureConnected()
    {
        if (_connected && !string.IsNullOrWhiteSpace(_api.AccessToken)) return true;
        MessageBox.Show(this, "Connect to your Yoinker server first.", "Not Connected", MessageBoxButton.OK, MessageBoxImage.Information);
        ShowSection("Settings");
        return false;
    }

    private static string ComboValue(ComboBox combo, string fallback) =>
        combo.SelectedItem is ComboBoxItem { Content: string text } && !string.IsNullOrWhiteSpace(text) ? text : fallback;

    private static string NormalizeTheme(string? value)
    {
        if (!string.IsNullOrWhiteSpace(value) && ThemePalettes.ContainsKey(value))
        {
            return value;
        }
        return "classic";
    }

    private static Color ParseColor(string hex) => (Color)ColorConverter.ConvertFromString(hex);

    private void SetBrushColor(string key, string hex)
    {
        if (Resources[key] is SolidColorBrush brush)
        {
            var color = ParseColor(hex);
            if (brush.IsFrozen)
            {
                // Some WPF resource brushes are frozen at runtime; replace them instead.
                Resources[key] = new SolidColorBrush(color);
                return;
            }
            brush.Color = color;
        }
    }

    private void ApplyTheme(string? themeName)
    {
        var normalized = NormalizeTheme(themeName);
        var palette = ThemePalettes[normalized];
        SetBrushColor("Brush.Window", palette.Window);
        SetBrushColor("Brush.Sidebar", palette.Sidebar);
        SetBrushColor("Brush.Panel", palette.Panel);
        SetBrushColor("Brush.Card", palette.Card);
        SetBrushColor("Brush.Border", palette.Border);
        SetBrushColor("Brush.BorderStrong", palette.BorderStrong);
        SetBrushColor("Brush.TextPrimary", palette.TextPrimary);
        SetBrushColor("Brush.TextSecondary", palette.TextSecondary);
        SetBrushColor("Brush.Accent", palette.Accent);
        SetBrushColor("Brush.AccentText", palette.AccentText);
        SetBrushColor("Brush.Input", palette.Input);
        SetBrushColor("Brush.NavButton", palette.NavButton);
        SetBrushColor("Brush.SecondaryButton", palette.SecondaryButton);
        SetBrushColor("Brush.Player", palette.Player);
        _settings.Theme = normalized;

        if (ThemePresetCombo is not null)
        {
            _suppressThemeSelection = true;
            foreach (var option in ThemePresetCombo.Items.OfType<ComboBoxItem>())
            {
                if (string.Equals(option.Content?.ToString(), normalized, StringComparison.OrdinalIgnoreCase))
                {
                    ThemePresetCombo.SelectedItem = option;
                    break;
                }
            }
            _suppressThemeSelection = false;
        }
    }

    private void ShowSection(string section)
    {
        HomeSection.Visibility = section == "Home" ? Visibility.Visible : Visibility.Collapsed;
        LibrarySection.Visibility = section == "Library" ? Visibility.Visible : Visibility.Collapsed;
        AlbumsSection.Visibility = section == "Albums" ? Visibility.Visible : Visibility.Collapsed;
        DownloadsSection.Visibility = section == "Downloads" ? Visibility.Visible : Visibility.Collapsed;
        YBSection.Visibility = section == "YB" ? Visibility.Visible : Visibility.Collapsed;
        SettingsSection.Visibility = section == "Settings" ? Visibility.Visible : Visibility.Collapsed;
        if (section != "Home" && section != "Library" && section != "Albums" && section != "Downloads" && section != "YB" && section != "Settings")
        {
            section = "Home";
            HomeSection.Visibility = Visibility.Visible;
            LibrarySection.Visibility = Visibility.Collapsed;
            AlbumsSection.Visibility = Visibility.Collapsed;
            DownloadsSection.Visibility = Visibility.Collapsed;
            YBSection.Visibility = Visibility.Collapsed;
            SettingsSection.Visibility = Visibility.Collapsed;
        }
        _settings.LastSection = section;
    }

    private string? MediaArtwork(MediaFileRead media) =>
        string.IsNullOrWhiteSpace(media.ArtworkRelativePath) ? null : _api.GetMediaArtworkUrl(media.Id);

    private string? DiscoveryArtwork(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        return _connected ? _api.GetDiscoveryArtworkProxyUrl(url) : url;
    }

    private PlaybackEntry EntryFromMedia(MediaFileRead media) => new()
    {
        MediaId = media.Id,
        Title = media.Title,
        Subtitle = string.Join(" | ", new[] { media.Uploader, media.Album }.Where(v => !string.IsNullOrWhiteSpace(v))),
        SourceUri = _api.GetMediaStreamUrl(media.Id),
        ArtworkUrl = MediaArtwork(media),
        IsLocalFile = false,
    };

    private async Task LoadOfflineAsync()
    {
        _offline.Clear();
        _view.OfflineItems.Clear();
        foreach (var item in await _state.LoadOfflineItemsAsync())
        {
            _offline[item.MediaId] = item;
            _view.OfflineItems.Add(new OfflineTrackCard { Item = item });
        }
    }

    private async Task SaveOfflineAsync(MediaFileRead media)
    {
        var root = string.IsNullOrWhiteSpace(_settings.DownloadRoot)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyMusic), "Yoinker")
            : _settings.DownloadRoot;
        var artist = UiFormat.SanitizePathSegment(media.Uploader, "Unknown Artist");
        var album = UiFormat.SanitizePathSegment(media.Album, "Singles");
        var dir = Path.Combine(root, artist, album);
        var localPath = await _api.DownloadMediaAsync(media.Id, dir, media.Title);
        _offline[media.Id] = new OfflineTrackRecord
        {
            MediaId = media.Id,
            Title = media.Title,
            Artist = media.Uploader,
            Album = media.Album,
            LocalPath = localPath,
            ArtworkUrl = MediaArtwork(media),
            DurationSeconds = media.DurationSeconds,
            DownloadedAt = DateTimeOffset.Now,
        };
        await _state.SaveOfflineItemsAsync(_offline.Values);
        await LoadOfflineAsync();
    }

    private void StartPlayback(PlaybackEntry entry)
    {
        if (!Uri.TryCreate(entry.SourceUri, UriKind.Absolute, out var uri))
        {
            MessageBox.Show(this, "Invalid playback URL.", "Playback", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        PlayerElement.Source = uri;
        PlayerElement.Volume = VolumeSlider.Value / 100.0;
        PlayerElement.Play();
        _playing = true;
        _view.PlayPauseLabel = "Pause";
        _view.NowPlayingTitle = entry.Title;
        _view.NowPlayingSubtitle = entry.Subtitle;
        _view.CurrentArtworkUrl = entry.ArtworkUrl ?? string.Empty;
        _view.PlayerElapsedLabel = "0:00";
        _view.PlayerDurationLabel = "--:--";
    }

    private void UpdatePlaybackProgress()
    {
        if (!_playing || PlayerElement.Source is null || !PlayerElement.NaturalDuration.HasTimeSpan) return;
        var elapsed = PlayerElement.Position;
        var total = PlayerElement.NaturalDuration.TimeSpan;
        _view.PlayerElapsedLabel = UiFormat.Duration((int)elapsed.TotalSeconds);
        _view.PlayerDurationLabel = UiFormat.Duration((int)total.TotalSeconds);
        if (_dragSeek) return;
        _muteSeekEvent = true;
        PlayerPositionSlider.Maximum = Math.Max(total.TotalSeconds, 1);
        PlayerPositionSlider.Value = Math.Min(elapsed.TotalSeconds, PlayerPositionSlider.Maximum);
        _muteSeekEvent = false;
    }

    private async Task RefreshLibraryAsync(string? query = null)
    {
        if (!EnsureConnected()) return;
        var page = await _api.ListLibraryAsync(query, "recent");
        _view.LibraryItems.Clear();
        foreach (var media in page.Items)
        {
            _view.LibraryItems.Add(new LibraryTrackCard
            {
                Media = media,
                ArtworkUrl = MediaArtwork(media),
                IsDownloaded = _offline.ContainsKey(media.Id),
            });
        }
    }

    private async Task RefreshAlbumsAsync()
    {
        if (!EnsureConnected()) return;
        var albums = await _api.ListAlbumsAsync();
        _view.AlbumItems.Clear();
        foreach (var album in albums.OrderBy(v => v.Artist).ThenBy(v => v.Title))
        {
            _view.AlbumItems.Add(new AlbumCard
            {
                Album = album,
                DownloadedTracks = album.Items.Count(i => _offline.ContainsKey(i.Id)),
                ArtworkUrl = album.ArtworkMediaId is int mediaId ? _api.GetMediaArtworkUrl(mediaId) : null,
            });
        }
    }

    private async Task RefreshJobsAsync()
    {
        if (!EnsureConnected()) return;
        var jobs = await _api.ListJobsAsync();
        _view.JobItems.Clear();
        foreach (var job in jobs.OrderByDescending(v => v.UpdatedAt).Take(40))
        {
            _view.JobItems.Add(new JobCard { Job = job });
        }
    }

    private async Task AutoRefreshJobsAsync()
    {
        if (!_connected || _pollingJobs)
        {
            return;
        }
        _pollingJobs = true;
        try
        {
            var jobs = await _api.ListJobsAsync();
            _view.JobItems.Clear();
            foreach (var job in jobs.OrderByDescending(v => v.UpdatedAt).Take(40))
            {
                _view.JobItems.Add(new JobCard { Job = job });
            }
        }
        catch
        {
            // Keep the desktop player responsive even if a periodic poll fails once.
        }
        finally
        {
            _pollingJobs = false;
        }
    }

    private async Task PreviewDiscoveryAsync(DiscoverySearchResult item)
    {
        var session = await _api.CreateDiscoveryStreamSessionAsync(new DiscoveryStreamSessionRequestDto
        {
            Source = item.Source,
            CanonicalSourceUrl = item.CanonicalSourceUrl,
            Title = item.Title,
            Artist = item.Artist,
            Album = item.Album,
            DurationSeconds = item.DurationSeconds,
            ArtworkUrl = item.ArtworkUrl,
            ProviderId = item.ProviderId,
        });
        _queueIndex = -1;
        StartPlayback(new PlaybackEntry
        {
            Title = item.Title,
            Subtitle = string.Join(" | ", new[] { item.Artist, item.Album, item.Source.ToUpperInvariant() }.Where(v => !string.IsNullOrWhiteSpace(v))),
            SourceUri = _api.GetDiscoveryStreamUrl(session.SessionToken),
            ArtworkUrl = DiscoveryArtwork(item.ArtworkUrl) ?? item.ArtworkUrl,
            IsLocalFile = false,
        });
    }

    private DiscoverySearchResult? ChooseVersion(HomeResultCard card)
    {
        if (card.VersionGroup is null)
        {
            return card.PrimaryVersion;
        }

        var picker = new VersionPickerWindow(card.VersionGroup)
        {
            Owner = this,
        };
        return picker.ShowDialog() == true ? picker.SelectedVersion : null;
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        await Guard(async () =>
        {
            _settings = await _state.LoadSettingsAsync();
            if (string.IsNullOrWhiteSpace(_settings.DownloadRoot))
            {
                _settings.DownloadRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyMusic), "Yoinker");
            }
            ServerUrlTextBox.Text = _settings.ServerUrl;
            UsernameTextBox.Text = _settings.Username;
            DownloadRootTextBox.Text = _settings.DownloadRoot;
            ApplyTheme(_settings.Theme);
            await LoadOfflineAsync();

            var token = DesktopStateStore.UnprotectToken(_settings.ProtectedToken);
            _api.Configure(_settings.ServerUrl, token);
            if (!string.IsNullOrWhiteSpace(token))
            {
                try
                {
                    var me = await _api.GetMeAsync();
                    _connected = true;
                    _view.ConnectionStatus = $"Connected as {me.Username}";
                    await RefreshJobsAsync();
                    await RefreshLibraryAsync();
                    await RefreshAlbumsAsync();
                    _jobsPollTimer.Start();
                }
                catch
                {
                    _connected = false;
                    _view.ConnectionStatus = "Saved session expired. Reconnect in Settings.";
                }
            }
            else
            {
                _view.ConnectionStatus = "Not connected. Open Settings.";
            }

            ShowSection(string.IsNullOrWhiteSpace(_settings.LastSection) || _settings.LastSection == "Legacy" ? "Home" : _settings.LastSection);
            VolumeSlider.Value = 75;
            PlayerElement.Volume = 0.75;
        }, "initialize the desktop app");
    }

    private async void SectionButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string section }) return;
        ShowSection(section);
        if (section == "Library") await Guard(() => RefreshLibraryAsync(LibraryFilterTextBox.Text), "refresh library");
        if (section == "Albums") await Guard(RefreshAlbumsAsync, "refresh albums");
        if (section == "Downloads") await Guard(LoadOfflineAsync, "refresh downloads");
    }

    private async void HomeSearch_Click(object sender, RoutedEventArgs e)
    {
        await Guard(async () =>
        {
            if (!EnsureConnected()) return;
            var query = CatalogQueryTextBox.Text?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(query)) return;
            var searchType = ComboValue(CatalogSearchTypeCombo, "song");
            _view.HomeResults.Clear();
            if (string.Equals(searchType, "song", StringComparison.OrdinalIgnoreCase))
            {
                var page = await _api.SearchVersionGroupsAsync(
                    query,
                    ComboValue(CatalogSourceCombo, "youtube"),
                    CatalogSecondaryQueryTextBox.Text?.Trim());
                foreach (var group in page.Items)
                {
                    var art = DiscoveryArtwork(group.ArtworkUrl) ?? group.ArtworkUrl;
                    _view.HomeResults.Add(new HomeResultCard { VersionGroup = group, ArtworkOverrideUrl = art });
                }
                return;
            }

            var catalogPage = await _api.SearchCatalogAsync(query, searchType, CatalogSecondaryQueryTextBox.Text?.Trim());
            foreach (var result in catalogPage.Items)
            {
                _view.HomeResults.Add(new HomeResultCard { Result = result, ArtworkOverrideUrl = result.ArtworkUrl });
            }
        }, "search catalog");
    }

    private async void HomePreview_Click(object sender, RoutedEventArgs e)
    {
        await Guard(async () =>
        {
            if (!EnsureConnected()) return;
            if (sender is Button { Tag: HomeResultCard card } && card.PrimaryVersion is not null)
            {
                await PreviewDiscoveryAsync(card.PrimaryVersion);
            }
        }, "preview track");
    }

    private async void HomeImport_Click(object sender, RoutedEventArgs e)
    {
        await Guard(async () =>
        {
            if (!EnsureConnected()) return;
            if (sender is not Button { Tag: HomeResultCard card }) return;
            if (card.IsVersionGroup)
            {
                var chosenVersion = ChooseVersion(card);
                if (chosenVersion is null)
                {
                    return;
                }
                await _api.ImportDiscoveryAsync(new DiscoveryImportRequestDto
                {
                    Source = chosenVersion.Source,
                    CanonicalSourceUrl = chosenVersion.CanonicalSourceUrl,
                    Title = chosenVersion.Title,
                    Artist = chosenVersion.Artist,
                    Album = chosenVersion.Album,
                    DurationSeconds = chosenVersion.DurationSeconds,
                    ArtworkUrl = chosenVersion.ArtworkUrl,
                    ProviderId = chosenVersion.ProviderId,
                    AudioBitrateKbps = 192,
                    EnrichMetadata = true,
                });
                await RefreshJobsAsync();
                return;
            }
            if (card.IsAlbum)
            {
                var result = await _api.ImportCatalogAlbumAsync(new CatalogAlbumImportRequestDto
                {
                    ReleaseId = card.Result!.CatalogId,
                    Title = card.Result.Title,
                    Artist = card.Result.Artist,
                    ArtworkUrl = card.Result.ArtworkUrl,
                    AudioBitrateKbps = 192,
                    EnrichMetadata = true,
                });
                MessageBox.Show(this, $"Album import queued.\nTracks: {result.TotalTracks}\nQueued jobs: {result.QueuedJobs}", "Album import", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            else
            {
                await _api.ImportCatalogTrackAsync(new CatalogTrackImportRequestDto
                {
                    Title = card.Result!.Title,
                    Artist = card.Result.Artist,
                    Album = card.Result.Album,
                    ArtworkUrl = card.Result.ArtworkUrl,
                    PreferredMatch = card.Result.BestMatch is null ? null : new DiscoveryImportRequestDto
                    {
                        Source = card.Result.BestMatch.Source,
                        CanonicalSourceUrl = card.Result.BestMatch.CanonicalSourceUrl,
                        Title = card.Result.BestMatch.Title,
                        Artist = card.Result.BestMatch.Artist,
                        Album = card.Result.BestMatch.Album,
                        DurationSeconds = card.Result.BestMatch.DurationSeconds,
                        ArtworkUrl = card.Result.BestMatch.ArtworkUrl,
                        ProviderId = card.Result.BestMatch.ProviderId,
                        AudioBitrateKbps = 192,
                        EnrichMetadata = true,
                    },
                });
            }
            await RefreshJobsAsync();
        }, "queue import");
    }

    private async void LibraryRefresh_Click(object sender, RoutedEventArgs e) => await Guard(() => RefreshLibraryAsync(LibraryFilterTextBox.Text), "refresh library");

    private void LibraryPlay_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureConnected()) return;
        if (sender is Button { Tag: LibraryTrackCard card })
        {
            _queueIndex = -1;
            StartPlayback(EntryFromMedia(card.Media));
        }
    }

    private void LibraryQueue_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureConnected()) return;
        if (sender is Button { Tag: LibraryTrackCard card })
        {
            _view.PlaybackQueue.Add(EntryFromMedia(card.Media));
        }
    }

    private async void LibraryDownload_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (sender is not Button { Tag: LibraryTrackCard card }) return;
        await SaveOfflineAsync(card.Media);
        await RefreshLibraryAsync(LibraryFilterTextBox.Text);
        await RefreshAlbumsAsync();
    }, "download track");

    private async void LibraryDelete_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (!EnsureConnected()) return;
        if (sender is not Button { Tag: LibraryTrackCard card }) return;
        if (MessageBox.Show(this, $"Delete '{card.Media.Title}' from server library?", "Delete", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        await _api.DeleteMediaAsync(card.Media.Id);
        await RefreshLibraryAsync(LibraryFilterTextBox.Text);
        await RefreshAlbumsAsync();
    }, "delete track");

    private async void AlbumsRefresh_Click(object sender, RoutedEventArgs e) => await Guard(RefreshAlbumsAsync, "refresh albums");

    private void AlbumPlay_Click(object sender, RoutedEventArgs e)
    {
        if (!EnsureConnected()) return;
        if (sender is not Button { Tag: AlbumCard card }) return;
        _view.PlaybackQueue.Clear();
        foreach (var entry in card.Album.Items.Where(m => m.MediaType == "audio").Select(EntryFromMedia))
        {
            _view.PlaybackQueue.Add(entry);
        }
        if (_view.PlaybackQueue.Count == 0) return;
        _queueIndex = 0;
        StartPlayback(_view.PlaybackQueue[0]);
    }

    private async void AlbumDownload_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (sender is not Button { Tag: AlbumCard card }) return;
        foreach (var media in card.Album.Items.Where(m => m.MediaType == "audio"))
        {
            await SaveOfflineAsync(media);
        }
        await RefreshLibraryAsync(LibraryFilterTextBox.Text);
        await RefreshAlbumsAsync();
    }, "download album");

    private void OpenDownloadsFolder_Click(object sender, RoutedEventArgs e)
    {
        var folder = string.IsNullOrWhiteSpace(_settings.DownloadRoot)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyMusic), "Yoinker")
            : _settings.DownloadRoot;
        Directory.CreateDirectory(folder);
        Process.Start(new ProcessStartInfo { FileName = folder, UseShellExecute = true });
    }

    private async void DownloadsRefresh_Click(object sender, RoutedEventArgs e) => await Guard(LoadOfflineAsync, "refresh downloads");

    private void OfflinePlay_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: OfflineTrackCard card }) return;
        if (!File.Exists(card.Item.LocalPath))
        {
            MessageBox.Show(this, "File no longer exists.", "Offline", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        _queueIndex = -1;
        StartPlayback(new PlaybackEntry
        {
            MediaId = card.Item.MediaId,
            Title = card.Item.Title,
            Subtitle = string.Join(" | ", new[] { card.Item.Artist, card.Item.Album }.Where(v => !string.IsNullOrWhiteSpace(v))),
            SourceUri = new Uri(card.Item.LocalPath).AbsoluteUri,
            IsLocalFile = true,
            ArtworkUrl = card.Item.ArtworkUrl,
        });
    }

    private void OfflineOpenFile_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: OfflineTrackCard card })
        {
            return;
        }
        if (!File.Exists(card.Item.LocalPath))
        {
            return;
        }
        Process.Start(new ProcessStartInfo { FileName = card.Item.LocalPath, UseShellExecute = true });
    }

    private async void OfflineRemove_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (sender is not Button { Tag: OfflineTrackCard card }) return;
        _offline.Remove(card.Item.MediaId);
        await _state.SaveOfflineItemsAsync(_offline.Values);
        await LoadOfflineAsync();
        await RefreshLibraryAsync(LibraryFilterTextBox.Text);
        await RefreshAlbumsAsync();
    }, "remove offline track");

    private async void DiscoverySearch_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (!EnsureConnected()) return;
        var query = DiscoveryQueryTextBox.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(query)) return;
        var page = await _api.SearchDiscoveryAsync(query, ComboValue(DiscoverySourceCombo, "youtube"), ComboValue(DiscoveryTypeCombo, "song"));
        _view.DiscoveryItems.Clear();
        foreach (var item in page.Items)
        {
            _view.DiscoveryItems.Add(new DiscoveryResultCard { Result = item, ArtworkUrl = DiscoveryArtwork(item.ArtworkUrl) ?? item.ArtworkUrl });
        }
    }, "search provider");

    private async void DiscoveryPreview_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (!EnsureConnected()) return;
        if (sender is Button { Tag: DiscoveryResultCard card }) await PreviewDiscoveryAsync(card.Result);
    }, "preview result");

    private async void DiscoveryImport_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (!EnsureConnected()) return;
        if (sender is not Button { Tag: DiscoveryResultCard card }) return;
        await _api.ImportDiscoveryAsync(new DiscoveryImportRequestDto
        {
            Source = card.Result.Source,
            CanonicalSourceUrl = card.Result.CanonicalSourceUrl,
            Title = card.Result.Title,
            Artist = card.Result.Artist,
            Album = card.Result.Album,
            DurationSeconds = card.Result.DurationSeconds,
            ArtworkUrl = card.Result.ArtworkUrl,
            ProviderId = card.Result.ProviderId,
            AudioBitrateKbps = 192,
            EnrichMetadata = true,
        });
        await RefreshJobsAsync();
    }, "import result");

    private async void UrlImport_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        if (!EnsureConnected()) return;
        var url = UrlImportTextBox.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(url)) return;
        await _api.CreateUrlJobAsync(new UrlJobRequestDto
        {
            Url = url,
            Mode = ComboValue(UrlModeCombo, "audio"),
            AudioBitrateKbps = 192,
            VideoQuality = "best",
            AllowPlaylist = AllowPlaylistCheckBox.IsChecked == true,
        });
        UrlImportTextBox.Clear();
        await RefreshJobsAsync();
    }, "create URL job");

    private async void Connect_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        var server = ServerUrlTextBox.Text?.Trim() ?? string.Empty;
        var username = UsernameTextBox.Text?.Trim() ?? string.Empty;
        var password = PasswordBox.Password ?? string.Empty;
        if (string.IsNullOrWhiteSpace(server) || string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            MessageBox.Show(this, "Server URL, username and password are required.", "Connect", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        _api.Configure(server);
        var token = await _api.LoginAsync(username, password);
        var me = await _api.GetMeAsync();
        _connected = true;
        _view.ConnectionStatus = $"Connected as {me.Username}";
        _settings.ServerUrl = server;
        _settings.Username = username;
        _settings.DownloadRoot = DownloadRootTextBox.Text?.Trim() ?? _settings.DownloadRoot;
        _settings.ProtectedToken = DesktopStateStore.ProtectToken(token);
        _settings.LastSection = "Home";
        await _state.SaveSettingsAsync(_settings);
        await RefreshJobsAsync();
        await RefreshLibraryAsync();
        await RefreshAlbumsAsync();
        _jobsPollTimer.Start();
        ShowSection("Home");
    }, "connect");

    private async void SaveSettings_Click(object sender, RoutedEventArgs e) => await Guard(async () =>
    {
        _settings.ServerUrl = ServerUrlTextBox.Text?.Trim() ?? _settings.ServerUrl;
        _settings.Username = UsernameTextBox.Text?.Trim() ?? _settings.Username;
        _settings.DownloadRoot = DownloadRootTextBox.Text?.Trim() ?? _settings.DownloadRoot;
        _settings.Theme = NormalizeTheme(ComboValue(ThemePresetCombo, _settings.Theme));
        if (!string.IsNullOrWhiteSpace(_api.AccessToken))
        {
            _settings.ProtectedToken = DesktopStateStore.ProtectToken(_api.AccessToken);
        }
        await _state.SaveSettingsAsync(_settings);
        MessageBox.Show(this, "Settings saved.", "Settings", MessageBoxButton.OK, MessageBoxImage.Information);
    }, "save settings");

    private async void ThemePresetCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressThemeSelection || ThemePresetCombo is null)
        {
            return;
        }
        ApplyTheme(ComboValue(ThemePresetCombo, "classic"));
        await Guard(() => _state.SaveSettingsAsync(_settings), "save theme");
    }

    private void LaunchLegacy_Click(object sender, RoutedEventArgs e)
    {
        var repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        var legacyPath = Path.Combine(repoRoot, "yoinker.py");
        if (!File.Exists(legacyPath))
        {
            MessageBox.Show(this, "Could not find yoinker.py", "Legacy", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        var python = @"C:\Users\sunny\AppData\Local\Programs\Python\Python311\python.exe";
        var psi = File.Exists(python)
            ? new ProcessStartInfo { FileName = python, Arguments = $"\"{legacyPath}\"", WorkingDirectory = repoRoot }
            : new ProcessStartInfo { FileName = legacyPath, WorkingDirectory = repoRoot, UseShellExecute = true };
        Process.Start(psi);
    }

    private void OpenProjectFolder_Click(object sender, RoutedEventArgs e)
    {
        var repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        Process.Start(new ProcessStartInfo { FileName = repoRoot, UseShellExecute = true });
    }

    private async void JobsRefresh_Click(object sender, RoutedEventArgs e) => await Guard(RefreshJobsAsync, "refresh jobs");

    private void PlayerPrev_Click(object sender, RoutedEventArgs e)
    {
        if (_view.PlaybackQueue.Count == 0) return;
        _queueIndex = Math.Max(_queueIndex - 1, 0);
        StartPlayback(_view.PlaybackQueue[_queueIndex]);
    }

    private void PlayerPlayPause_Click(object sender, RoutedEventArgs e)
    {
        if (PlayerElement.Source is null) return;
        if (_playing) { PlayerElement.Pause(); _playing = false; _view.PlayPauseLabel = "Play"; }
        else { PlayerElement.Play(); _playing = true; _view.PlayPauseLabel = "Pause"; }
    }

    private void PlayerNext_Click(object sender, RoutedEventArgs e)
    {
        if (_view.PlaybackQueue.Count == 0) return;
        _queueIndex = _queueIndex < 0 ? 0 : Math.Min(_queueIndex + 1, _view.PlaybackQueue.Count - 1);
        StartPlayback(_view.PlaybackQueue[_queueIndex]);
    }

    private void PlayerPositionSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (_muteSeekEvent || _dragSeek || PlayerElement is null || PlayerElement.Source is null) return;
        PlayerElement.Position = TimeSpan.FromSeconds(PlayerPositionSlider.Value);
    }

    private void PlayerPositionSlider_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e) => _dragSeek = true;

    private void PlayerPositionSlider_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        _dragSeek = false;
        if (PlayerElement is null || PlayerElement.Source is null) return;
        PlayerElement.Position = TimeSpan.FromSeconds(PlayerPositionSlider.Value);
    }

    private void VolumeSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (PlayerElement is null) return;
        PlayerElement.Volume = VolumeSlider.Value / 100.0;
    }

    private void PlayerElement_MediaOpened(object sender, RoutedEventArgs e)
    {
        _playing = true;
        _view.PlayPauseLabel = "Pause";
        _timer.Start();
        UpdatePlaybackProgress();
    }

    private void PlayerElement_MediaEnded(object sender, RoutedEventArgs e)
    {
        _playing = false;
        _view.PlayPauseLabel = "Play";
        _timer.Stop();
        if (_queueIndex >= 0 && _queueIndex + 1 < _view.PlaybackQueue.Count)
        {
            _queueIndex++;
            StartPlayback(_view.PlaybackQueue[_queueIndex]);
        }
    }

    private void PlayerElement_MediaFailed(object sender, ExceptionRoutedEventArgs e)
    {
        _playing = false;
        _view.PlayPauseLabel = "Play";
        _timer.Stop();
        MessageBox.Show(this, $"Playback failed: {e.ErrorException?.Message ?? "Unknown media error"}", "Playback", MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private sealed class ViewState : INotifyPropertyChanged
    {
        private string _connectionStatus = "Not connected";
        private string _nowPlayingTitle = "Nothing playing";
        private string _nowPlayingSubtitle = "Connect and start streaming";
        private string _currentArtworkUrl = string.Empty;
        private string _playPauseLabel = "Play";
        private string _elapsed = "0:00";
        private string _duration = "--:--";

        public ObservableCollection<HomeResultCard> HomeResults { get; } = [];
        public ObservableCollection<LibraryTrackCard> LibraryItems { get; } = [];
        public ObservableCollection<AlbumCard> AlbumItems { get; } = [];
        public ObservableCollection<OfflineTrackCard> OfflineItems { get; } = [];
        public ObservableCollection<DiscoveryResultCard> DiscoveryItems { get; } = [];
        public ObservableCollection<JobCard> JobItems { get; } = [];
        public ObservableCollection<PlaybackEntry> PlaybackQueue { get; } = [];

        public string ConnectionStatus { get => _connectionStatus; set => Set(ref _connectionStatus, value); }
        public string NowPlayingTitle { get => _nowPlayingTitle; set => Set(ref _nowPlayingTitle, value); }
        public string NowPlayingSubtitle { get => _nowPlayingSubtitle; set => Set(ref _nowPlayingSubtitle, value); }
        public string CurrentArtworkUrl { get => _currentArtworkUrl; set => Set(ref _currentArtworkUrl, value); }
        public string PlayPauseLabel { get => _playPauseLabel; set => Set(ref _playPauseLabel, value); }
        public string PlayerElapsedLabel { get => _elapsed; set => Set(ref _elapsed, value); }
        public string PlayerDurationLabel { get => _duration; set => Set(ref _duration, value); }

        public event PropertyChangedEventHandler? PropertyChanged;

        private void Set<T>(ref T field, T value, [CallerMemberName] string? member = null)
        {
            if (EqualityComparer<T>.Default.Equals(field, value)) return;
            field = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(member));
        }
    }
}
