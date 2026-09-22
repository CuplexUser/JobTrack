using System.Text;
using System.Text.Json;

namespace JobTrack.Host.Hosting;

/// <summary>
/// Best-effort pushes the resolved UI language to the running server's
/// <c>PUT /api/settings/language</c>, the same <c>app_settings</c> row the web app's Settings
/// page language card reads and writes (see <c>apps/api/src/services/settings.service.ts</c>'s
/// <c>getLanguage</c>/<c>updateLanguage</c>). "Best-effort": the server may not be up yet, or may
/// be restarting, and changing the language here must never wait on it or fail because of it —
/// this application's own UI has already applied the change by the time this is called.
/// </summary>
/// <remarks>Same loopback-always, token-header shape as <see cref="ReminderPoller"/>.</remarks>
internal sealed class LanguageSync : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };
    private readonly Func<string?> _token;
    private readonly RollingLog _log;
    private string? _baseUrl;

    public LanguageSync(Func<string?> token, RollingLog log)
    {
        _token = token;
        _log = log;
    }

    public void SetPort(int port) => _baseUrl = $"http://127.0.0.1:{port}";

    public async Task PushAsync(string code)
    {
        if (_baseUrl is not { } baseUrl) return;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Put, $"{baseUrl}/api/settings/language")
            {
                Content = new StringContent(JsonSerializer.Serialize(new { code }), Encoding.UTF8, "application/json"),
            };
            if (_token() is { } token) request.Headers.Add("X-JobTrack-Token", token);

            using var response = await _http.SendAsync(request);
            if (!response.IsSuccessStatusCode) _log.Write($"language sync: server answered {(int)response.StatusCode}");
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            // The server restarting, or not up yet. The next change, or the next launch, tries again.
            _log.Write($"language sync: {error.GetType().Name}: {error.Message}");
        }
    }

    public void Dispose() => _http.Dispose();
}
