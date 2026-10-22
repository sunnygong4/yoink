using System.IO;

namespace Yoinker.Desktop.Services;

public static class UiFormat
{
    public static string Duration(int? totalSeconds)
    {
        if (totalSeconds is null || totalSeconds <= 0)
        {
            return "--:--";
        }

        var span = TimeSpan.FromSeconds(totalSeconds.Value);
        return span.TotalHours >= 1
            ? $"{(int)span.TotalHours}:{span.Minutes:00}:{span.Seconds:00}"
            : $"{span.Minutes}:{span.Seconds:00}";
    }

    public static string SanitizePathSegment(string? value, string fallback)
    {
        var raw = string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(raw.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? fallback : cleaned;
    }
}
