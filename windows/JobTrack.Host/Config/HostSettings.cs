using System.Text.Json;
using System.Text.Json.Serialization;

namespace JobTrack.Host.Config;

/// <summary>
/// Preferences that belong to this application rather than to the server.
/// </summary>
/// <remarks>
/// Kept out of <c>.env</c> deliberately. That file is the server's configuration and is shared
/// with the npm channel, where none of these mean anything; putting "have we shown the first-run
/// balloon yet" in it would be noise in a file the user is expected to read.
/// </remarks>
internal sealed class HostSettings
{
    [JsonPropertyName("openBrowserOnStart")] public bool OpenBrowserOnStart { get; set; }

    /// <summary>
    /// The UI language, or null to follow Windows' own display language. See
    /// <see cref="JobTrack.Host.Localization.TranslationSource"/> for how this resolves to an
    /// actual culture, and <see cref="Hosting.LanguageSync"/> for how it is shared with the web
    /// app through the same <c>app_settings</c> row the web Settings page's language card reads
    /// and writes.
    /// </summary>
    [JsonPropertyName("language")] public string? Language { get; set; }

    /// <summary>
    /// Whether the "JobTrack is running down here" balloon has been shown. Windows 11 hides new
    /// tray icons by default, so without this the app looks like it did nothing at all.
    /// </summary>
    [JsonPropertyName("firstRunShown")] public bool FirstRunShown { get; set; }

    /// <summary>
    /// Whether to show a balloon when a follow-up or a reconnect date comes due. On by default:
    /// those dates were set by the user in order to be reminded, and a reminder only notifies.
    /// </summary>
    [JsonPropertyName("remindersEnabled")] public bool RemindersEnabled { get; set; } = true;

    /// <summary>
    /// Whether to keep Claude Desktop's <c>jobtrack</c> MCP server pointed at the one bundled here
    /// (see <see cref="ClaudeDesktop"/>). On by default: it only touches Claude Desktop when it is
    /// installed, and the alternative is a Claude that silently runs an outdated server.
    /// </summary>
    [JsonPropertyName("connectClaudeDesktop")] public bool ConnectClaudeDesktop { get; set; } = true;

    /// <summary>
    /// The MCP server version Claude Desktop was last told about, so an upgrade that brings a new
    /// one says to restart Claude Desktop exactly once.
    /// </summary>
    [JsonPropertyName("claudeDesktopMcpVersion")] public string? ClaudeDesktopMcpVersion { get; set; }

    /// <summary>
    /// Whether to look for a newer release on GitHub twice a day. On by default: an update is only
    /// ever offered, never installed without a click.
    /// </summary>
    [JsonPropertyName("checkForUpdates")] public bool CheckForUpdates { get; set; } = true;

    /// <summary>When GitHub was last asked, so restarting often does not mean asking often.</summary>
    [JsonPropertyName("lastUpdateCheck")] public DateTimeOffset? LastUpdateCheck { get; set; }

    /// <summary>The update checker saves from a background thread while the UI may be saving too.</summary>
    private readonly Lock _saveGate = new();

    public static HostSettings Load()
    {
        try
        {
            var path = Paths.HostSettingsFile;
            if (!File.Exists(path)) return new HostSettings();
            return JsonSerializer.Deserialize<HostSettings>(File.ReadAllText(path)) ?? new HostSettings();
        }
        catch (Exception error) when (error is IOException or JsonException)
        {
            return new HostSettings();
        }
    }

    public void Save()
    {
        lock (_saveGate)
        {
            try
            {
                var path = Paths.HostSettingsFile;
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllText(path, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch (IOException)
            {
                // Losing a preference is not worth interrupting anyone over.
            }
        }
    }
}
