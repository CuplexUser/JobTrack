using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using JobTrack.Host.Hosting;

namespace JobTrack.Host.Config;

/// <summary>
/// Keeps Claude Desktop's <c>jobtrack</c> MCP server pointed at the one this installation bundles.
/// </summary>
/// <remarks>
/// Without this, Claude Desktop runs whichever MCP server its config names, and the common case is
/// a global <c>npm install -g @jobtrack/mcp</c> that nothing ever updates: the tray and the
/// installer move on while Claude keeps talking to a server several releases old, missing tools
/// the rest of JobTrack has. Pointing the entry at the bundled server makes the installer the one
/// thing that decides the version, and checking on every start means an upgrade takes effect
/// without anyone editing JSON.
///
/// It edits the config in place rather than owning it. Everything else in the file (other servers,
/// Claude's own preferences) is kept, and so is any variable the user added to the entry's
/// <c>env</c>, such as <c>SEMANTIC_SEARCH=false</c>. The file is written only when the entry
/// actually changes, and never when it does not parse: a config this cannot read is left for the
/// user rather than replaced.
///
/// Only a Claude Desktop that is installed gets an entry. The classic installer's app reads
/// <c>%APPDATA%\Claude</c>; the MSIX-packaged one reads a virtualized copy under its package's
/// <c>LocalCache</c>. Both are looked for, and a config file is only ever created inside a
/// directory Claude Desktop already made.
/// </remarks>
internal static class ClaudeDesktop
{
    private const string ConfigFileName = "claude_desktop_config.json";

    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        WriteIndented = true,
        IndentSize = 2,
        // Claude Desktop writes plain, readable JSON; the default encoder would rewrite every
        // non-ASCII character and '+' in the file as a \u escape.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly JsonDocumentOptions ReadOptions = new()
    {
        AllowTrailingCommas = true,
        CommentHandling = JsonCommentHandling.Skip,
    };

    /// <param name="ConfigsFound">How many Claude Desktop config directories exist.</param>
    /// <param name="Changed">How many config files were rewritten.</param>
    /// <param name="Problems">Files that were left alone, and why.</param>
    internal sealed record Result(int ConfigsFound, int Changed, IReadOnlyList<string> Problems);

    /// <summary>Every directory Claude Desktop keeps its config in on this machine.</summary>
    public static IEnumerable<string> ConfigDirectories()
    {
        var roaming = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Claude");
        if (Directory.Exists(roaming)) yield return roaming;

        var packages = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Packages");
        string[] packaged;
        try
        {
            packaged = Directory.Exists(packages) ? Directory.GetDirectories(packages, "*Claude*") : [];
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            packaged = [];
        }
        foreach (var package in packaged)
        {
            var virtualized = Path.Combine(package, "LocalCache", "Roaming", "Claude");
            if (Directory.Exists(virtualized)) yield return virtualized;
        }
    }

    /// <summary>Points every Claude Desktop config's <c>jobtrack</c> entry at this installation.</summary>
    public static Result Register(LaunchManifest manifest) => Register(manifest, ConfigDirectories());

    internal static Result Register(LaunchManifest manifest, IEnumerable<string> directories) =>
        Apply(directories, servers =>
        {
            var entry = McpConfig.Entry(manifest);
            var existing = servers[McpConfig.ServerName] as JsonObject;

            // Keep what the user added; the keys this installation sets win.
            if (existing?["env"] is JsonObject previousEnv && entry["env"] is JsonObject env)
            {
                foreach (var (key, value) in previousEnv)
                {
                    if (!env.ContainsKey(key)) env[key] = value?.DeepClone();
                }
            }

            if (existing is not null && JsonNode.DeepEquals(existing, entry)) return false;
            servers[McpConfig.ServerName] = entry;
            return true;
        }, createIfMissing: true);

    /// <summary>
    /// Removes the <c>jobtrack</c> entry, but only where it runs this installation. An entry the
    /// user pointed somewhere else (an npm install, a checkout) is theirs and stays.
    /// </summary>
    public static Result Unregister() => Unregister(ConfigDirectories());

    internal static Result Unregister(IEnumerable<string> directories) =>
        Apply(directories, servers =>
        {
            if (servers[McpConfig.ServerName] is not JsonObject entry) return false;
            var command = entry["command"] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
            if (command is null || !IsInsideInstallDir(command)) return false;
            servers.Remove(McpConfig.ServerName);
            return true;
        }, createIfMissing: false);

    private static bool IsInsideInstallDir(string path)
    {
        try
        {
            return Path.GetFullPath(path).StartsWith(Paths.InstallDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return false;
        }
    }

    /// <param name="directories">Claude Desktop config directories; a parameter so it can be tried on copies.</param>
    /// <param name="change">Edits <c>mcpServers</c> and says whether it changed anything.</param>
    /// <param name="createIfMissing">Whether a Claude directory without a config file gets one.</param>
    private static Result Apply(IEnumerable<string> directories, Func<JsonObject, bool> change, bool createIfMissing)
    {
        var found = 0;
        var changed = 0;
        var problems = new List<string>();

        foreach (var directory in directories)
        {
            found++;
            var path = Path.Combine(directory, ConfigFileName);
            try
            {
                var exists = File.Exists(path);
                if (!exists && !createIfMissing) continue;

                var text = exists ? File.ReadAllText(path) : string.Empty;
                var root = string.IsNullOrWhiteSpace(text)
                    ? new JsonObject()
                    : JsonNode.Parse(text, documentOptions: ReadOptions) as JsonObject;
                if (root is null)
                {
                    problems.Add($"{path} is not a JSON object, so it was left alone");
                    continue;
                }

                root["mcpServers"] ??= new JsonObject();
                if (root["mcpServers"] is not JsonObject servers)
                {
                    problems.Add($"{path} has an mcpServers value that is not an object, so it was left alone");
                    continue;
                }

                if (!change(servers)) continue;
                WriteAtomically(path, root.ToJsonString(WriteOptions));
                changed++;
            }
            catch (JsonException error)
            {
                problems.Add($"{path} is not valid JSON, so it was left alone: {error.Message}");
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                problems.Add($"could not update {path}: {error.Message}");
            }
        }

        return new Result(found, changed, problems);
    }

    /// <summary>
    /// Writes beside the target and moves over it, so Claude Desktop reading the file at that
    /// moment sees the old config or the new one, never half of either.
    /// </summary>
    private static void WriteAtomically(string path, string contents)
    {
        var temporary = path + ".jobtrack-tmp";
        File.WriteAllText(temporary, contents + Environment.NewLine);
        File.Move(temporary, path, overwrite: true);
    }
}
