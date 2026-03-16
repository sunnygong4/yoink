using System.Net.Http;
using System.Net.Http.Headers;
using System.IO;
using System.Text;
using System.Text.Json;
using Yoinker.Desktop.Models;

namespace Yoinker.Desktop.Services;

public sealed class YoinkerApiClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _httpClient = new();

    public string BaseUrl { get; private set; } = "http://127.0.0.1:8000";
    public string? AccessToken { get; private set; }

    public void Configure(string baseUrl, string? accessToken = null)
    {
        BaseUrl = string.IsNullOrWhiteSpace(baseUrl) ? "http://127.0.0.1:8000" : baseUrl.Trim().TrimEnd('/');
        AccessToken = string.IsNullOrWhiteSpace(accessToken) ? null : accessToken;
        _httpClient.DefaultRequestHeaders.Authorization = string.IsNullOrWhiteSpace(AccessToken)
            ? null
            : new AuthenticationHeaderValue("Bearer", AccessToken);
    }

    public async Task<string> LoginAsync(string username, string password, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, ApiPath("/auth/token"))
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["username"] = username,
                ["password"] = password,
            }),
        };
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response);
        var payload = await ReadAsAsync<AuthTokenResponse>(response, cancellationToken);
        Configure(BaseUrl, payload.AccessToken);
        return payload.AccessToken;
    }

    public Task<UserRead> GetMeAsync(CancellationToken cancellationToken = default) =>
        GetAsync<UserRead>("/auth/me", cancellationToken);

    public Task<CatalogSearchPage> SearchCatalogAsync(
        string query,
        string searchType,
        string? secondaryQuery,
        int pageSize = 12,
        CancellationToken cancellationToken = default)
    {
        var queryString = BuildQuery(new Dictionary<string, string?>
        {
            ["q"] = query,
            ["search_type"] = searchType,
            ["page"] = "1",
            ["page_size"] = pageSize.ToString(),
            ["secondary_q"] = secondaryQuery,
        });
        return GetAsync<CatalogSearchPage>($"/catalog/search?{queryString}", cancellationToken);
    }

    public Task<VersionSearchPage> SearchVersionGroupsAsync(
        string query,
        string source,
        string? artistHint,
        int pageSize = 8,
        CancellationToken cancellationToken = default)
    {
        var queryString = BuildQuery(new Dictionary<string, string?>
        {
            ["q"] = query,
            ["source"] = source,
            ["artist_hint"] = artistHint,
            ["page"] = "1",
            ["page_size"] = pageSize.ToString(),
        });
        return GetAsync<VersionSearchPage>($"/search/versions?{queryString}", cancellationToken);
    }

    public Task<DownloadJobRead> ImportCatalogTrackAsync(
        CatalogTrackImportRequestDto payload,
        CancellationToken cancellationToken = default) =>
        PostAsync<CatalogTrackImportRequestDto, DownloadJobRead>("/catalog/import-track", payload, cancellationToken);

    public Task<CatalogAlbumImportRead> ImportCatalogAlbumAsync(
        CatalogAlbumImportRequestDto payload,
        CancellationToken cancellationToken = default) =>
        PostAsync<CatalogAlbumImportRequestDto, CatalogAlbumImportRead>("/catalog/import-album", payload, cancellationToken);

    public Task<MediaLibraryPage> ListLibraryAsync(
        string? query = null,
        string sort = "recent",
        CancellationToken cancellationToken = default)
    {
        var queryString = BuildQuery(new Dictionary<string, string?>
        {
            ["sort"] = sort,
            ["page"] = "1",
            ["page_size"] = "100",
            ["q"] = query,
        });
        return GetAsync<MediaLibraryPage>($"/library?{queryString}", cancellationToken);
    }

    public Task<List<AlbumGroupRead>> ListAlbumsAsync(CancellationToken cancellationToken = default) =>
        GetAsync<List<AlbumGroupRead>>("/library/albums", cancellationToken);

    public Task<List<DownloadJobRead>> ListJobsAsync(CancellationToken cancellationToken = default) =>
        GetAsync<List<DownloadJobRead>>("/jobs", cancellationToken);

    public Task DeleteMediaAsync(int mediaId, CancellationToken cancellationToken = default) =>
        DeleteAsync($"/library/{mediaId}", cancellationToken);

    public Task<DiscoverySearchPage> SearchDiscoveryAsync(
        string query,
        string source,
        string searchType,
        int pageSize = 12,
        CancellationToken cancellationToken = default)
    {
        var queryString = BuildQuery(new Dictionary<string, string?>
        {
            ["q"] = query,
            ["sources"] = source,
            ["search_type"] = searchType,
            ["page"] = "1",
            ["page_size"] = pageSize.ToString(),
        });
        return GetAsync<DiscoverySearchPage>($"/search?{queryString}", cancellationToken);
    }

    public Task<DiscoveryStreamSessionRead> CreateDiscoveryStreamSessionAsync(
        DiscoveryStreamSessionRequestDto payload,
        CancellationToken cancellationToken = default) =>
        PostAsync<DiscoveryStreamSessionRequestDto, DiscoveryStreamSessionRead>("/search/stream-session", payload, cancellationToken);

    public Task<DownloadJobRead> ImportDiscoveryAsync(
        DiscoveryImportRequestDto payload,
        CancellationToken cancellationToken = default) =>
        PostAsync<DiscoveryImportRequestDto, DownloadJobRead>("/search/import", payload, cancellationToken);

    public Task<DownloadJobRead> CreateUrlJobAsync(
        UrlJobRequestDto payload,
        CancellationToken cancellationToken = default) =>
        PostAsync<UrlJobRequestDto, DownloadJobRead>("/jobs", payload, cancellationToken);

    public string GetMediaStreamUrl(int mediaId)
    {
        EnsureToken();
        return $"{ApiPath($"/library/{mediaId}/stream")}?access_token={Uri.EscapeDataString(AccessToken!)}";
    }

    public string GetMediaArtworkUrl(int mediaId)
    {
        EnsureToken();
        return $"{ApiPath($"/library/{mediaId}/artwork")}?access_token={Uri.EscapeDataString(AccessToken!)}";
    }

    public string GetDiscoveryArtworkProxyUrl(string upstreamUrl)
    {
        EnsureToken();
        return $"{ApiPath("/search/artwork")}?access_token={Uri.EscapeDataString(AccessToken!)}&url={Uri.EscapeDataString(upstreamUrl)}";
    }

    public string GetDiscoveryStreamUrl(string sessionToken)
    {
        EnsureToken();
        return $"{ApiPath($"/search/stream/{sessionToken}")}?access_token={Uri.EscapeDataString(AccessToken!)}";
    }

    public async Task<string> DownloadMediaAsync(
        int mediaId,
        string destinationDirectory,
        string preferredFileStem,
        CancellationToken cancellationToken = default)
    {
        EnsureToken();
        using var request = new HttpRequestMessage(HttpMethod.Get, ApiPath($"/library/{mediaId}/download"));
        using var response = await _httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        await EnsureSuccessAsync(response);

        var responseFileName = response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"');
        var extension = Path.GetExtension(responseFileName);
        if (string.IsNullOrWhiteSpace(extension))
        {
            extension = ".mp3";
        }

        Directory.CreateDirectory(destinationDirectory);
        var safeStem = UiFormat.SanitizePathSegment(preferredFileStem, $"track-{mediaId}");
        var destinationPath = BuildUniquePath(Path.Combine(destinationDirectory, safeStem + extension));
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var destination = File.Create(destinationPath);
        await source.CopyToAsync(destination, cancellationToken);
        return destinationPath;
    }

    private async Task<T> GetAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync(ApiPath(path), cancellationToken);
        await EnsureSuccessAsync(response);
        return await ReadAsAsync<T>(response, cancellationToken);
    }

    private async Task<TResponse> PostAsync<TRequest, TResponse>(string path, TRequest payload, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        using var response = await _httpClient.PostAsync(
            ApiPath(path),
            new StringContent(json, Encoding.UTF8, "application/json"),
            cancellationToken);
        await EnsureSuccessAsync(response);
        return await ReadAsAsync<TResponse>(response, cancellationToken);
    }

    private async Task DeleteAsync(string path, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.DeleteAsync(ApiPath(path), cancellationToken);
        await EnsureSuccessAsync(response);
    }

    private async Task<T> ReadAsAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        return (await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken))
            ?? throw new InvalidOperationException("API returned an empty response.");
    }

    private async Task EnsureSuccessAsync(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        string detail;
        try
        {
            var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            detail = document.RootElement.TryGetProperty("detail", out var detailElement)
                ? detailElement.ToString()
                : response.ReasonPhrase ?? "The request failed.";
        }
        catch
        {
            detail = response.ReasonPhrase ?? "The request failed.";
        }
        throw new InvalidOperationException(detail);
    }

    private string ApiPath(string path) => $"{BaseUrl}/api/v1{path}";

    private static string BuildQuery(Dictionary<string, string?> parameters)
    {
        var pairs = parameters
            .Where(pair => !string.IsNullOrWhiteSpace(pair.Value))
            .Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value!)}");
        return string.Join("&", pairs);
    }

    private static string BuildUniquePath(string path)
    {
        if (!File.Exists(path))
        {
            return path;
        }

        var directory = Path.GetDirectoryName(path) ?? string.Empty;
        var fileNameWithoutExtension = Path.GetFileNameWithoutExtension(path);
        var extension = Path.GetExtension(path);
        var counter = 2;
        while (true)
        {
            var candidate = Path.Combine(directory, $"{fileNameWithoutExtension} ({counter}){extension}");
            if (!File.Exists(candidate))
            {
                return candidate;
            }
            counter += 1;
        }
    }

    private void EnsureToken()
    {
        if (string.IsNullOrWhiteSpace(AccessToken))
        {
            throw new InvalidOperationException("Please sign in to the Yoinker server first.");
        }
    }
}
