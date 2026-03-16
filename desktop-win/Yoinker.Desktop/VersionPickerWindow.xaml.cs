using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using Yoinker.Desktop.Models;
using Yoinker.Desktop.Services;

namespace Yoinker.Desktop;

public partial class VersionPickerWindow : Window
{
    private readonly PickerState _state;

    public DiscoverySearchResult? SelectedVersion => _state.SelectedOption?.Version;

    public VersionPickerWindow(VersionGroupRead group)
    {
        InitializeComponent();
        _state = new PickerState
        {
            HeaderText = $"{group.DisplayTitle} - {group.DisplayArtist ?? "Unknown artist"}",
        };

        var options = new List<VersionOptionCard>
        {
            new()
            {
                Version = group.SelectedVersion,
                IsRecommended = true,
            },
        };
        options.AddRange((group.AlternateVersions ?? []).Select(version => new VersionOptionCard
        {
            Version = version,
            IsRecommended = false,
        }));

        foreach (var option in options)
        {
            _state.Options.Add(option);
        }
        _state.SelectedOption = _state.Options.FirstOrDefault();
        DataContext = _state;
    }

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        if (_state.SelectedOption is null)
        {
            MessageBox.Show(this, "Choose a version first.", "Choose Version", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    private sealed class PickerState : INotifyPropertyChanged
    {
        private string _headerText = string.Empty;
        private VersionOptionCard? _selectedOption;

        public ObservableCollection<VersionOptionCard> Options { get; } = [];

        public string HeaderText
        {
            get => _headerText;
            set => Set(ref _headerText, value);
        }

        public VersionOptionCard? SelectedOption
        {
            get => _selectedOption;
            set => Set(ref _selectedOption, value);
        }

        public event PropertyChangedEventHandler? PropertyChanged;

        private void Set<T>(ref T field, T value, [CallerMemberName] string? member = null)
        {
            if (EqualityComparer<T>.Default.Equals(field, value))
            {
                return;
            }
            field = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(member));
        }
    }

    private sealed class VersionOptionCard
    {
        public required DiscoverySearchResult Version { get; init; }

        public bool IsRecommended { get; init; }

        public string Title => Version.Title;

        public string ArtistLine => Version.Artist ?? "Unknown artist";

        public string MetaLine => string.Join(" | ", new[]
        {
            Version.Album,
            UiFormat.Duration(Version.DurationSeconds),
            Version.Source.ToUpperInvariant(),
        }.Where(value => !string.IsNullOrWhiteSpace(value)));

        public string BadgeText => IsRecommended ? "Recommended" : "Alternate version";
    }
}
