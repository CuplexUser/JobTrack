using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using JobTrack.Host.Config;
using JobTrack.Host.Hosting;

namespace JobTrack.Host.Updates;

/// <summary>A published release that is newer than this one, with what is needed to install it.</summary>
internal sealed record ReleaseInfo(Version Version, string InstallerName, string InstallerUrl, string ChecksumUrl, string PageUrl, long Size);

/// <summary>Where the updater is. Each state carries only what the UI needs to show it.</summary>
internal abstract record UpdateStatus
{
    public sealed record Idle : UpdateStatus;
    public sealed record Checking : UpdateStatus;
    public sealed record UpToDate(DateTimeOffset CheckedAt) : UpdateStatus;
    public sealed record Available(ReleaseInfo Release) : UpdateStatus;
    public sealed record Downloading(ReleaseInfo Release, double Progress) : UpdateStatus;
    public sealed record Installing(ReleaseInfo Release) : UpdateStatus;
    /// <param name="Release">The release this was about, if a check got that far, so it can be retried.</param>
    public sealed record Failed(string Message, ReleaseInfo? Release) : UpdateStatus;
}

/// <summary>
/// Finds out whether a newer JobTrack has been released, and fetches it when asked.
/// </summary>
/// <remarks>
/// The feed is the GitHub release that <c>.github/workflows/windows-release.yml</c> publishes
/// for every version, which already carries the installer and a <c>.sha256</c> beside it. So an
/// update is exactly what someone downloading it by hand would get: same file, same checksum.
/// <c>releases/latest</c> never returns drafts or prereleases, so a manually dispatched draft
/// build is never offered to anyone.
///
/// Nothing here installs anything on its own. A check at most offers an update; installing it is
/// a click, and then <see cref="UpdateInstaller"/>'s job.
///
/// <c>JOBTRACK_UPDATE_FEED</c> replaces the GitHub URL with any URL that answers in the same
/// shape. It is how the whole flow is tested against a local build before a release exists.
/// </remarks>
internal sealed class UpdateService : IDisposable
{
    private const string LatestReleaseUrl = "https://api.github.com/repos/CuplexUser/JobTrack/releases/latest";
    private const string FeedOverrideVariable = "JOBTRACK_UPDATE_FEED";

    private static readonly TimeSpan FirstCheckDelay = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(12);

    private readonly HttpClient _http;
    private readonly HostSettings _settings;
    private readonly RollingLog _log;
    private readonly string _feedUrl;
    private readonly Lock _statusGate = new();
    private System.Threading.Timer? _timer;
    private int _busy;

    /// <summary>Raised on whatever thread the change happened on.</summary>
    public event Action<UpdateStatus>? StatusChanged;

    public UpdateStatus Status { get; private set; } = new UpdateStatus.Idle();

    public static Version CurrentVersion { get; } = Version.Parse(VersionInfo.Host);

    public UpdateService(HostSettings settings, RollingLog log)
    {
        _settings = settings;
        _log = log;
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        // GitHub refuses API requests without a User-Agent.
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("JobTrack", VersionInfo.Host));

        _feedUrl = Environment.GetEnvironmentVariable(FeedOverrideVariable) is { Length: > 0 } feed ? feed : LatestReleaseUrl;
        if (_feedUrl != LatestReleaseUrl) _log.Write($"updates: using {FeedOverrideVariable}={_feedUrl}");

        UpdateInstaller.DeleteStaleDownloads();
    }

    /// <summary>
    /// Starts or stops the twice-daily check, following <see cref="HostSettings.CheckForUpdates"/>.
    /// </summary>
    public void ApplySchedule()
    {
        if (!_settings.CheckForUpdates)
        {
            _timer?.Dispose();
            _timer = null;
            return;
        }
        if (_timer is not null) return;

        // A check is due twelve hours after the last one, but never sooner than two minutes after
        // starting: signing in is busy enough without a network request in the middle of it.
        var due = (_settings.LastUpdateCheck ?? DateTimeOffset.MinValue) + CheckInterval - DateTimeOffset.UtcNow;
        var delay = due > FirstCheckDelay ? due : FirstCheckDelay;
        _timer = new System.Threading.Timer(_ => _ = CheckAsync(), null, delay, CheckInterval);
    }

    /// <summary>Asks the feed whether there is a newer release. Never throws.</summary>
    public async Task<UpdateStatus> CheckAsync()
    {
        // A download or install in flight is further along than any check could take it.
        if (Status is UpdateStatus.Downloading or UpdateStatus.Installing) return Status;
        if (Interlocked.Exchange(ref _busy, 1) == 1) return Status;
        try
        {
            SetStatus(new UpdateStatus.Checking());
            var release = await FetchLatestAsync();
            _settings.LastUpdateCheck = DateTimeOffset.UtcNow;
            _settings.Save();

            if (release is null || release.Version <= CurrentVersion)
            {
                return SetStatus(new UpdateStatus.UpToDate(DateTimeOffset.Now));
            }
            _log.Write($"updates: {release.Version} is available");
            return SetStatus(new UpdateStatus.Available(release));
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or FormatException)
        {
            _log.Write($"updates: check failed: {error.GetType().Name}: {error.Message}");
            return SetStatus(new UpdateStatus.Failed("Could not reach GitHub to check for updates.", null));
        }
        finally
        {
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    /// <summary>
    /// Downloads and verifies the offered release.
    /// </summary>
    /// <returns>The verified installer's path, or null when that failed (and <see cref="Status"/> says why).</returns>
    public async Task<string?> DownloadAsync(ReleaseInfo release)
    {
        if (Interlocked.Exchange(ref _busy, 1) == 1) return null;
        try
        {
            SetStatus(new UpdateStatus.Downloading(release, 0));
            var lastReported = -1;
            var progress = new Progress<double>(fraction =>
            {
                // Whole percents only: every buffer's worth of progress would flood the UI thread.
                var percent = (int)(fraction * 100);
                if (percent == lastReported) return;
                lastReported = percent;
                SetStatus(new UpdateStatus.Downloading(release, fraction));
            });

            var path = await UpdateInstaller.DownloadAndVerifyAsync(_http, release, progress);
            _log.Write($"updates: downloaded and verified {path}");
            return path;
        }
        catch (UpdateVerificationException error)
        {
            _log.Write($"updates: refused {release.InstallerName}: {error.Message}");
            SetStatus(new UpdateStatus.Failed(error.Message, release));
            return null;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or IOException or UnauthorizedAccessException)
        {
            _log.Write($"updates: download failed: {error.GetType().Name}: {error.Message}");
            SetStatus(new UpdateStatus.Failed("The update could not be downloaded. Try again later.", release));
            return null;
        }
        finally
        {
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    /// <summary>Starts the verified installer. True when it is running and this app should quit.</summary>
    public bool Install(ReleaseInfo release, string installerPath)
    {
        try
        {
            UpdateInstaller.Launch(installerPath);
            _log.Write($"updates: started the installer for {release.Version}");
            SetStatus(new UpdateStatus.Installing(release));
            return true;
        }
        catch (Exception error) when (error is Win32Exception or IOException)
        {
            _log.Write($"updates: could not start the installer: {error.Message}");
            SetStatus(new UpdateStatus.Failed("The installer could not be started.", release));
            return false;
        }
    }

    private UpdateStatus SetStatus(UpdateStatus status)
    {
        lock (_statusGate) Status = status;
        StatusChanged?.Invoke(status);
        return status;
    }

    private async Task<ReleaseInfo?> FetchLatestAsync()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, _feedUrl);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        using var response = await _http.SendAsync(request);

        // No release published at all yet is not a failure, just nothing to offer.
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();

        var latest = await JsonSerializer.DeserializeAsync<GitHubRelease>(await response.Content.ReadAsStreamAsync());
        if (latest is null || latest.Draft || latest.Prerelease) return null;

        if (!Version.TryParse(latest.TagName.TrimStart('v', 'V'), out var version))
        {
            throw new FormatException($"release tag \"{latest.TagName}\" is not a version");
        }

        // The names windows-release.yml gives them. A release whose installer is still uploading,
        // or one that never got one, is not offered: there would be nothing to install.
        var installerName = $"JobTrack-Setup-{version.ToString(3)}.exe";
        var installer = latest.Assets.FirstOrDefault(asset => asset.Name.Equals(installerName, StringComparison.OrdinalIgnoreCase));
        var checksum = latest.Assets.FirstOrDefault(asset => asset.Name.Equals($"{installerName}.sha256", StringComparison.OrdinalIgnoreCase));
        if (installer is null || checksum is null)
        {
            _log.Write($"updates: {latest.TagName} has no installer attached yet");
            return null;
        }

        return new ReleaseInfo(version, installerName, installer.DownloadUrl, checksum.DownloadUrl, latest.PageUrl, installer.Size);
    }

    public void Dispose()
    {
        _timer?.Dispose();
        _http.Dispose();
    }

    private sealed class GitHubRelease
    {
        [JsonPropertyName("tag_name")] public string TagName { get; init; } = "";
        [JsonPropertyName("html_url")] public string PageUrl { get; init; } = "";
        [JsonPropertyName("draft")] public bool Draft { get; init; }
        [JsonPropertyName("prerelease")] public bool Prerelease { get; init; }
        [JsonPropertyName("assets")] public List<GitHubAsset> Assets { get; init; } = [];
    }

    private sealed class GitHubAsset
    {
        [JsonPropertyName("name")] public string Name { get; init; } = "";
        [JsonPropertyName("browser_download_url")] public string DownloadUrl { get; init; } = "";
        [JsonPropertyName("size")] public long Size { get; init; }
    }
}
