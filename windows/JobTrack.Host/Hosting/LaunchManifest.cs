using System.Text.Json;
using System.Text.Json.Serialization;
using JobTrack.Host.Config;

namespace JobTrack.Host.Hosting;

/// <summary>
/// <c>app/launch.json</c>: how to start the server, decided at packaging time.
/// </summary>
/// <remarks>
/// The host does not work out how to run the payload — <c>windows/scripts/build-payload.mjs</c>
/// does, by asking the payload's own Node to resolve tsx's documented export names inside the
/// payload's own tree, and writing the answers here. That matters because the files next to
/// <c>tsx/dist/loader.mjs</c> are hash-named: resolving them here would mean this application
/// carrying assumptions about another package's internals, and a tsx upgrade that moved something
/// would break a user's install instead of failing a build.
///
/// Every path is relative to the install root, since where the user installs is unknown when this
/// file is written.
/// </remarks>
internal sealed class LaunchManifest
{
    [JsonPropertyName("schema")] public int Schema { get; init; }
    [JsonPropertyName("jobtrackVersion")] public string JobtrackVersion { get; init; } = "";
    [JsonPropertyName("apiVersion")] public string? ApiVersion { get; init; }
    [JsonPropertyName("mcpVersion")] public string? McpVersion { get; init; }
    [JsonPropertyName("nodeVersion")] public string NodeVersion { get; init; } = "";
    [JsonPropertyName("node")] public string Node { get; init; } = "";
    [JsonPropertyName("cwd")] public string Cwd { get; init; } = "app";
    [JsonPropertyName("require")] public string Require { get; init; } = "";
    [JsonPropertyName("import")] public string Import { get; init; } = "";
    [JsonPropertyName("entry")] public string Entry { get; init; } = "";
    [JsonPropertyName("args")] public string[] Args { get; init; } = [];
    [JsonPropertyName("tsconfig")] public string? Tsconfig { get; init; }
    [JsonPropertyName("envExample")] public string? EnvExample { get; init; }
    [JsonPropertyName("webDist")] public string? WebDist { get; init; }
    [JsonPropertyName("mcpEntry")] public string? McpEntry { get; init; }

    public static LaunchManifest Load()
    {
        var path = Paths.LaunchManifestFile;
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                $"The JobTrack payload is missing its launch manifest ({path}). Reinstalling should fix it.", path);
        }

        var manifest = JsonSerializer.Deserialize<LaunchManifest>(File.ReadAllText(path))
                       ?? throw new InvalidDataException($"{path} is not a valid launch manifest.");

        if (manifest.Schema != 1) throw new InvalidDataException($"{path} has schema {manifest.Schema}; this build understands 1.");
        return manifest;
    }

    public string NodeExe => Paths.Resolve(Node);

    public string WorkingDirectory => Paths.Resolve(Cwd);

    /// <summary>
    /// The full argument list, including the data directory.
    /// </summary>
    /// <remarks>
    /// <c>--home</c> is a flag rather than an inherited <c>JOBTRACK_HOME</c> on purpose:
    /// <c>apps/tray/bin/jobtrack.js</c> documents that handing a Node child a reconstructed
    /// environment breaks tsx's loader, and a launcher that never has to set an environment
    /// variable cannot trip over that at all. The variable is set as well, belt and braces, for
    /// anything the server shells out to.
    /// </remarks>
    public IEnumerable<string> BuildArguments()
    {
        yield return "--require";
        yield return Paths.Resolve(Require);
        yield return "--import";
        // Not a plain path: Node reads the "C:" of a Windows path as a URL protocol. Uri also
        // percent-encodes, so an install directory containing spaces survives.
        yield return new Uri(Paths.Resolve(Import)).AbsoluteUri;
        yield return Paths.Resolve(Entry);
        foreach (var arg in Args) yield return arg;
        yield return "--home";
        yield return Paths.JobtrackHome;
    }
}

/// <summary>What the server reports about itself once it is listening.</summary>
internal sealed record ReadyInfo
{
    [JsonPropertyName("url")] public string Url { get; init; } = "";
    [JsonPropertyName("host")] public string Host { get; init; } = "";
    [JsonPropertyName("port")] public int Port { get; init; }
    [JsonPropertyName("version")] public string Version { get; init; } = "";
    [JsonPropertyName("driver")] public string Driver { get; init; } = "";
}

/// <summary>A named startup failure, as opposed to a stack trace nobody can act on.</summary>
internal sealed record ServerError
{
    [JsonPropertyName("code")] public string Code { get; init; } = "";
    [JsonPropertyName("host")] public string? Host { get; init; }
    [JsonPropertyName("port")] public int Port { get; init; }
}
