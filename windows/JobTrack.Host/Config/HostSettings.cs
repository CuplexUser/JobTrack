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
    /// Whether the "JobTrack is running down here" balloon has been shown. Windows 11 hides new
    /// tray icons by default, so without this the app looks like it did nothing at all.
    /// </summary>
    [JsonPropertyName("firstRunShown")] public bool FirstRunShown { get; set; }

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
