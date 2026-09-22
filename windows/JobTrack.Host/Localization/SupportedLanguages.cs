using System.Globalization;

namespace JobTrack.Host.Localization;

/// <summary>
/// Every language this build ships a satellite resource assembly for. The drop-in point for a
/// third language later: add its `Resources/Strings.&lt;code&gt;.resx`, list it here, and add it
/// to the csproj's `SatelliteResourceLanguages` — nothing else in this project names a language
/// by hand. Mirrors `apps/web/src/locales/index.ts`'s `SUPPORTED_LANGUAGES`, which is the same
/// idea for the web app.
/// </summary>
internal static class SupportedLanguages
{
    public static readonly IReadOnlyList<(string Code, string NameKey)> All =
    [
        ("en", "general.languageEnglish"),
        ("sv", "general.languageSwedish"),
    ];

    public const string Fallback = "en";

    /// <summary>
    /// Resolves a preference to a culture: an explicit, supported code if one was chosen, or
    /// else whichever of <see cref="All"/> best matches Windows' own display language, or else
    /// <see cref="Fallback"/>.
    /// </summary>
    public static CultureInfo Resolve(string? preference)
    {
        if (preference is not null && All.Any(l => l.Code == preference)) return CultureInfo.GetCultureInfo(preference);

        var systemLanguage = CultureInfo.InstalledUICulture.TwoLetterISOLanguageName;
        var matched = All.FirstOrDefault(l => l.Code == systemLanguage).Code ?? Fallback;
        return CultureInfo.GetCultureInfo(matched);
    }
}
