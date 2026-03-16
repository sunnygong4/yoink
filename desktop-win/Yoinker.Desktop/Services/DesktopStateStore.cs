using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.IO;
using Yoinker.Desktop.Models;

namespace Yoinker.Desktop.Services;

public sealed class DesktopStateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _rootDirectory;
    private readonly string _settingsPath;
    private readonly string _offlinePath;

    public DesktopStateStore()
    {
        _rootDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "YoinkerDesktopPrototype");
        _settingsPath = Path.Combine(_rootDirectory, "settings.json");
        _offlinePath = Path.Combine(_rootDirectory, "offline-media.json");
    }

    public async Task<DesktopSettings> LoadSettingsAsync()
    {
        Directory.CreateDirectory(_rootDirectory);
        if (!File.Exists(_settingsPath))
        {
            return new DesktopSettings();
        }

        await using var stream = File.OpenRead(_settingsPath);
        return await JsonSerializer.DeserializeAsync<DesktopSettings>(stream, JsonOptions) ?? new DesktopSettings();
    }

    public async Task SaveSettingsAsync(DesktopSettings settings)
    {
        Directory.CreateDirectory(_rootDirectory);
        await using var stream = File.Create(_settingsPath);
        await JsonSerializer.SerializeAsync(stream, settings, JsonOptions);
    }

    public async Task<List<OfflineTrackRecord>> LoadOfflineItemsAsync()
    {
        Directory.CreateDirectory(_rootDirectory);
        if (!File.Exists(_offlinePath))
        {
            return [];
        }

        await using var stream = File.OpenRead(_offlinePath);
        var items = await JsonSerializer.DeserializeAsync<List<OfflineTrackRecord>>(stream, JsonOptions) ?? [];
        return items.Where(item => File.Exists(item.LocalPath)).ToList();
    }

    public async Task SaveOfflineItemsAsync(IEnumerable<OfflineTrackRecord> items)
    {
        Directory.CreateDirectory(_rootDirectory);
        await using var stream = File.Create(_offlinePath);
        await JsonSerializer.SerializeAsync(stream, items.ToList(), JsonOptions);
    }

    public static string? ProtectToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        var plainBytes = Encoding.UTF8.GetBytes(token);
        var protectedBytes = ProtectedData.Protect(plainBytes, null, DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(protectedBytes);
    }

    public static string? UnprotectToken(string? protectedToken)
    {
        if (string.IsNullOrWhiteSpace(protectedToken))
        {
            return null;
        }

        try
        {
            var protectedBytes = Convert.FromBase64String(protectedToken);
            var plainBytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(plainBytes);
        }
        catch
        {
            return null;
        }
    }
}
