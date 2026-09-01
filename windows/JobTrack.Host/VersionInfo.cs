namespace JobTrack.Host;

/// <summary>
/// This application's version, which is also the `jobtrack` npm version.
/// </summary>
/// <remarks>
/// There is one version number for the whole Windows build, and it comes from
/// apps/tray/package.json: windows/scripts/build-payload.mjs writes it into version.props,
/// the csproj imports that, and the installer is compiled with the same value. So the tray
/// header, the About box, the installer and the npm release cannot disagree.
/// </remarks>
internal static class VersionInfo
{
    public static string Host { get; } =
        typeof(VersionInfo).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
}
