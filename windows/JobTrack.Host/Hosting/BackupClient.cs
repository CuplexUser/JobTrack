using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace JobTrack.Host.Hosting;

/// <summary>
/// Talks to the running server's automatic backup endpoints (<c>/api/backup/auto</c>, see
/// <c>apps/api/src/routes/backup.routes.ts</c>), for the Backup settings page and for noticing a
/// failed backup.
/// </summary>
/// <remarks>
/// The server owns the backup settings and runs the backups; this side only reads and edits them.
/// Settings are kept as a <see cref="JsonObject"/> rather than a typed model, so the sections this
/// app does not edit (the encryption keys, set up in the browser) are sent back exactly as they
/// came. Same loopback-always, token-header shape as <see cref="ReminderPoller"/>.
/// </remarks>
internal sealed class BackupClient : IDisposable
{
    private static readonly TimeSpan WatchInterval = TimeSpan.FromMinutes(15);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(5) };
    private readonly Func<string?> _token;
    private readonly RollingLog _log;
    private System.Threading.Timer? _timer;
    private string? _baseUrl;
    private string? _announcedFailure;

    /// <summary>Raised on a thread-pool thread when a backup has failed that was not reported yet.</summary>
    public event Action<BackupFailure>? BackupFailed;

    public BackupClient(Func<string?> token, RollingLog log)
    {
        _token = token;
        _log = log;
    }

    public bool IsConnected => _baseUrl is not null;

    /// <summary>Point at the server on <paramref name="port"/> and start watching for failed backups.</summary>
    public void Start(int port)
    {
        _baseUrl = $"http://127.0.0.1:{port}";
        _timer ??= new System.Threading.Timer(_ => _ = WatchAsync(), null, TimeSpan.FromMinutes(2), WatchInterval);
    }

    public void Stop()
    {
        _timer?.Dispose();
        _timer = null;
        _baseUrl = null;
    }

    public async Task<BackupStatus> GetStatusAsync() =>
        await SendAsync<BackupStatus>(HttpMethod.Get, "/api/backup/auto", null);

    public async Task<BackupStatus> SaveAsync(JsonObject config) =>
        await SendAsync<BackupStatus>(HttpMethod.Put, "/api/backup/auto", config);

    public async Task<BackupTestResult> TestAsync(JsonObject config) =>
        await SendAsync<BackupTestResult>(HttpMethod.Post, "/api/backup/auto/test",
            new JsonObject { ["destination"] = config["destination"]?.DeepClone(), ["encryption"] = config["encryption"]?.DeepClone() });

    public async Task<BackupRunResult> RunNowAsync() =>
        await SendAsync<BackupRunResult>(HttpMethod.Post, "/api/backup/auto/run", null);

    private async Task<T> SendAsync<T>(HttpMethod method, string path, JsonNode? body)
    {
        if (_baseUrl is not { } baseUrl) throw new BackupClientException(Resources.Strings.Get("backup.serverNotRunning"));

        using var request = new HttpRequestMessage(method, baseUrl + path);
        if (_token() is { } token) request.Headers.Add("X-JobTrack-Token", token);
        if (body is not null) request.Content = JsonContent.Create(body, options: Json);

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            throw new BackupClientException(Resources.Strings.Get("backup.serverNotRunning"));
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                // The server explains itself in `message` (see apps/api/src/lib/errors.ts).
                var problem = await response.Content.ReadFromJsonAsync<ServerError>(Json).ConfigureAwait(false);
                throw new BackupClientException(problem?.Message ?? $"HTTP {(int)response.StatusCode}");
            }
            return (await response.Content.ReadFromJsonAsync<T>(Json).ConfigureAwait(false))!;
        }
    }

    private async Task WatchAsync()
    {
        try
        {
            var status = await GetStatusAsync();
            var state = status.State;
            if (state.LastError is not { } error || state.LastRunAt is not { } runAt) return;
            // Once per failed run: the next failure has a new run time and is announced again.
            if (_announcedFailure == runAt) return;
            _announcedFailure = runAt;
            BackupFailed?.Invoke(new BackupFailure(error));
        }
        catch (Exception error) when (error is BackupClientException or JsonException)
        {
            _log.Write($"backup watch: {error.Message}");
        }
    }

    public void Dispose()
    {
        Stop();
        _http.Dispose();
    }

    private sealed record ServerError(string? Message);
}

internal sealed class BackupClientException(string message) : Exception(message);

internal sealed record BackupFailure(string Error);

internal sealed class BackupStatus
{
    /// <summary>Kept as JSON so sections this app does not edit go back to the server untouched.</summary>
    public JsonObject Config { get; set; } = [];
    public bool HasPassphrase { get; set; }
    public BackupRunState State { get; set; } = new();
    public string? NextRunAt { get; set; }
}

internal sealed class BackupRunState
{
    public string? LastRunAt { get; set; }
    public string? LastSuccessAt { get; set; }
    public string? LastError { get; set; }
    public string? LastFile { get; set; }
    public string? LastSkippedAt { get; set; }
}

internal sealed class BackupTestResult
{
    public bool Ok { get; set; }
    public List<string> Problems { get; set; } = [];
}

internal sealed class BackupRunResult
{
    public string Outcome { get; set; } = "";
    public string? File { get; set; }

    public List<string> Removed { get; set; } = [];
}
