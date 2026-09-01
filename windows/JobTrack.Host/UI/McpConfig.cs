using System.Text.Json;
using JobTrack.Host.Config;
using JobTrack.Host.Hosting;

namespace JobTrack.Host.UI;

/// <summary>
/// Generates the JSON block an MCP client needs in order to talk to this installation.
/// </summary>
/// <remarks>
/// The documented setup is <c>npm install -g @jobtrack/mcp</c> and <c>"command":
/// "jobtrack-mcp"</c>, which needs npm and a global bin on PATH — the two things this whole
/// build exists to stop requiring. The MCP server is in the payload already (it shares every
/// dependency with the API, so it costs about 2 MB compressed), so all that is missing is a
/// config block with absolute paths, and this writes it.
///
/// It bypasses <c>bin/jobtrack-mcp.js</c> for the same reason the server does — one process
/// instead of two — and sets <c>JOBTRACK_HOME</c> explicitly to exactly what that bin would have
/// set, so the MCP server and the tray share one database. That sharing is the stated intent of
/// the comment in that file, and repolayer opens SQLite in WAL mode with a busy timeout, so a
/// second reader alongside the running server is what the setup is built for.
/// </remarks>
internal static class McpConfig
{
    public static string Build(LaunchManifest manifest)
    {
        if (manifest.McpEntry is not { Length: > 0 } entry)
        {
            throw new InvalidOperationException("This build of JobTrack does not bundle the MCP server.");
        }

        var config = new
        {
            mcpServers = new
            {
                jobtrack = new
                {
                    command = manifest.NodeExe,
                    args = new[]
                    {
                        "--require", Paths.Resolve(manifest.Require),
                        "--import", new Uri(Paths.Resolve(manifest.Import)).AbsoluteUri,
                        Paths.Resolve(entry),
                    },
                    env = new Dictionary<string, string> { ["JOBTRACK_HOME"] = Paths.JobtrackHome },
                },
            },
        };

        return JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });
    }
}
