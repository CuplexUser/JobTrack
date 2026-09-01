namespace JobTrack.Host.Config;

/// <summary>
/// The API token the browser extension needs.
/// </summary>
/// <remarks>
/// Today getting this into the extension means opening <c>data/api-token</c> in a text editor and
/// copying it out by hand — <c>docs/capture.md</c> says exactly that, and it is the least
/// defensible step in setting JobTrack up. A Copy button in the settings dialog costs almost
/// nothing and removes it.
///
/// The server generates the token on first run and writes it to <c>data/api-token</c>
/// (apps/api/src/lib/api-token.ts) unless <c>API_TOKEN</c> is set in <c>.env</c>, in which case the
/// user is managing the secret themselves and that value wins. Both cases are read here, in the
/// same order the server resolves them.
/// </remarks>
internal static class ApiToken
{
    public static string? Read(EnvFile env)
    {
        if (env.Get("API_TOKEN") is { Length: > 0 } configured) return configured;

        try
        {
            var path = Paths.ApiTokenFile;
            if (!File.Exists(path)) return null;
            var token = File.ReadAllText(path).Trim();
            return token.Length == 0 ? null : token;
        }
        catch (IOException)
        {
            return null;
        }
    }

    /// <summary>
    /// Deletes the token file so the server mints a fresh one on its next start.
    /// </summary>
    /// <remarks>
    /// Only meaningful when the token is the generated one; an <c>API_TOKEN</c> in <c>.env</c> is
    /// the user's to change. Every extension already holding the old token stops working, which
    /// is the point of regenerating it, so the caller must say so first.
    /// </remarks>
    public static void Regenerate()
    {
        var path = Paths.ApiTokenFile;
        if (File.Exists(path)) File.Delete(path);
    }
}
