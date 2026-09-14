using System.Text.Json;
using System.Text.Json.Nodes;
using JobTrack.Host.Hosting;

namespace JobTrack.Host.Config;

/// <summary>
/// The MCP server entry an MCP client needs in order to talk to this installation.
/// </summary>
/// <remarks>
/// The documented setup is <c>npm install -g @jobtrack/mcp</c> and <c>"command":
/// "jobtrack-mcp"</c>, which needs npm and a global bin on PATH — the two things this whole
/// build exists to stop requiring. The MCP server is in the payload already (it shares every
/// dependency with the API, so it costs about 2 MB compressed), so all that is missing is an
/// entry with absolute paths, and this builds it. <see cref="ClaudeDesktop"/> writes it into
/// Claude Desktop's config; the tray's "Copy MCP client config" hands it to any other client.
///
/// It bypasses <c>bin/jobtrack-mcp.js</c> for the same reason the server does — one process
/// instead of two — and sets <c>JOBTRACK_HOME</c> explicitly to exactly what that bin would have
/// set, so the MCP server and the tray share one database. That sharing is the stated intent of
/// the comment in that file, and repolayer opens SQLite in WAL mode with a busy timeout, so a
/// second reader alongside the running server is what the setup is built for.
/// <c>TSX_TSCONFIG_PATH</c> is set for the reason <see cref="NodeSupervisor"/> sets it: tsx
/// searches upward for a tsconfig.json, and here the client decides the working directory.
///
/// Every path is inside the install directory and none carries a version, so the entry stays the
/// same across upgrades while the server behind it moves with each installer.
/// </remarks>
internal static class McpConfig
{
    public const string ServerName = "jobtrack";

    public static bool IsBundled(LaunchManifest manifest) => manifest.McpEntry is { Length: > 0 };

    public static JsonObject Entry(LaunchManifest manifest)
    {
        if (manifest.McpEntry is not { Length: > 0 } entry)
        {
            throw new InvalidOperationException("This build of JobTrack does not bundle the MCP server.");
        }

        var env = new JsonObject { ["JOBTRACK_HOME"] = Paths.JobtrackHome };
        if (manifest.Tsconfig is { } tsconfig) env["TSX_TSCONFIG_PATH"] = Paths.Resolve(tsconfig);

        return new JsonObject
        {
            ["command"] = manifest.NodeExe,
            ["args"] = new JsonArray(
                "--require", Paths.Resolve(manifest.Require),
                // Not a plain path: Node reads the "C:" of a Windows path as a URL protocol.
                "--import", new Uri(Paths.Resolve(manifest.Import)).AbsoluteUri,
                Paths.Resolve(entry)),
            ["env"] = env,
        };
    }

    /// <summary>A whole <c>mcpServers</c> block, ready to paste.</summary>
    public static string Build(LaunchManifest manifest)
    {
        var config = new JsonObject { ["mcpServers"] = new JsonObject { [ServerName] = Entry(manifest) } };
        return config.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }
}
