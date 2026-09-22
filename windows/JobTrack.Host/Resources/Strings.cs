using System.Globalization;
using System.Resources;

namespace JobTrack.Host.Resources;

/// <summary>
/// Looks strings up in Strings.resx / Strings.sv.resx by key.
/// </summary>
/// <remarks>
/// Written by hand rather than through Visual Studio's ResX code generator, which this project
/// is never opened in to run: there is no per-key static property, just <see cref="Get"/>. A key
/// missing from the current culture's satellite falls back to the neutral (English) resource
/// automatically — that is <see cref="ResourceManager"/>'s own behavior, needing nothing extra
/// here — and a key missing from both comes back wrapped in "!", so a typo is visible rather than
/// silently blank.
/// </remarks>
internal static class Strings
{
    private static readonly ResourceManager Manager =
        new("JobTrack.Host.Resources.Strings", typeof(Strings).Assembly);

    /// <summary>What <see cref="Get"/> resolves against. Set by <see cref="Localization.TranslationSource"/>.</summary>
    public static CultureInfo Culture { get; set; } = CultureInfo.CurrentUICulture;

    public static string Get(string key) => Manager.GetString(key, Culture) ?? $"!{key}!";
}
