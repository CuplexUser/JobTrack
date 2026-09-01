using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace JobTrack.Host.UI;

/// <summary>
/// One menu or button icon: a codepoint from Windows' icon font plus the color it is drawn in.
/// </summary>
/// <param name="Code">The codepoint in Segoe Fluent Icons / Segoe MDL2 Assets.</param>
/// <param name="OnLight">The color to use against a light surface.</param>
/// <param name="OnDark">The same icon lightened for a dark surface.</param>
internal readonly record struct Glyph(char Code, Color OnLight, Color OnDark);

/// <summary>
/// Menu and button icons, drawn from Windows' own icon font and tinted like Visual Studio's.
/// </summary>
/// <remarks>
/// Rendering glyphs beats shipping a folder of PNGs here: there is nothing to redraw for a second
/// DPI, and the shapes are the ones the rest of the operating system uses, so the menus look like
/// Windows rather than like an application that brought its own art.
///
/// The color is the one deliberate departure from the system palette. A column of identical gray
/// outlines gives the eye nothing to aim at, so each icon carries a hue from the same small,
/// meaning-carrying palette Visual Studio's image library uses — blue for the everyday verbs, gold
/// for folders, green for run and restart, red for the ones that stop or discard something. Each
/// hue comes in two values so a thin stroke keeps its contrast on a dark surface as well as a
/// light one; <see cref="Render"/> picks between them from the surface it is drawn against.
///
/// Windows 11 ships <c>Segoe Fluent Icons</c> and Windows 10 ships <c>Segoe MDL2 Assets</c>; the
/// codepoints below are the same in both. If neither is installed, every lookup returns null and
/// the menus simply have no icons, which is a perfectly good outcome.
/// </remarks>
internal static class Glyphs
{
    // The palette. Light-surface values are darkened well past Visual Studio's own, because these
    // icons are thin outlines rather than filled shapes and a filled shape can carry a much paler
    // color at the same apparent weight.
    private static readonly Color Blue = Color.FromArgb(0x00, 0x5D, 0xBA);
    private static readonly Color BlueLight = Color.FromArgb(0x4F, 0xB0, 0xFF);
    private static readonly Color Gold = Color.FromArgb(0xB0, 0x74, 0x00);
    private static readonly Color GoldLight = Color.FromArgb(0xE3, 0xB5, 0x5C);
    private static readonly Color Green = Color.FromArgb(0x1E, 0x82, 0x2F);
    private static readonly Color GreenLight = Color.FromArgb(0x6C, 0xC6, 0x4B);
    private static readonly Color Red = Color.FromArgb(0xC5, 0x0B, 0x17);
    private static readonly Color RedLight = Color.FromArgb(0xF2, 0x6A, 0x6A);
    private static readonly Color Purple = Color.FromArgb(0x68, 0x21, 0x7A);
    private static readonly Color PurpleLight = Color.FromArgb(0xC1, 0x8F, 0xD9);
    private static readonly Color Teal = Color.FromArgb(0x0E, 0x73, 0x7C);
    private static readonly Color TealLight = Color.FromArgb(0x4E, 0xC6, 0xCE);
    private static readonly Color Steel = Color.FromArgb(0x44, 0x54, 0x63);
    private static readonly Color SteelLight = Color.FromArgb(0xC0, 0xC8, 0xD0);

    // Codepoints from the Segoe MDL2 Assets / Segoe Fluent Icons chart. Each one was checked by
    // rendering it rather than trusted from a table -- E8B7 and E8A5, the codepoints usually
    // listed for "folder" and "document", actually draw a page and a blank rectangle.
    public static readonly Glyph Open = new((char)0xE8A7, Blue, BlueLight);        // OpenInNewWindow
    public static readonly Glyph Settings = new((char)0xE713, Steel, SteelLight);  // Setting
    public static readonly Glyph Copy = new((char)0xE8C8, Blue, BlueLight);        // Copy
    public static readonly Glyph Code = new((char)0xE943, Purple, PurpleLight);    // Code
    public static readonly Glyph Folder = new((char)0xF12B, Gold, GoldLight);      // FolderHorizontal
    public static readonly Glyph Document = new((char)0xE7C3, Blue, BlueLight);    // Page
    public static readonly Glyph Refresh = new((char)0xE72C, Green, GreenLight);   // Refresh
    public static readonly Glyph Power = new((char)0xE7E8, Red, RedLight);         // PowerButton
    public static readonly Glyph Lock = new((char)0xE72E, Teal, TealLight);        // Lock
    public static readonly Glyph Eye = new((char)0xE7B3, Steel, SteelLight);       // RedEye
    public static readonly Glyph Save = new((char)0xE74E, Blue, BlueLight);        // Save
    public static readonly Glyph Cancel = new((char)0xE711, Red, RedLight);        // Cancel

    private static readonly string? FontFamily = FirstInstalled("Segoe Fluent Icons", "Segoe MDL2 Assets");
    private static readonly Dictionary<(char Glyph, int Size, int Color), Image> Cache = [];
    private static readonly Lock CacheGate = new();

    /// <summary>
    /// A glyph rendered at the size a menu or toolbar wants for the given DPI, in whichever of its
    /// two values reads better against <paramref name="surface"/>.
    /// </summary>
    /// <returns>Null when no icon font is available, which callers treat as "no icon".</returns>
    public static Image? Render(Glyph glyph, Color surface, int dpi = 96, int logicalSize = 16)
    {
        if (FontFamily is null) return null;

        var color = surface.GetBrightness() < 0.5f ? glyph.OnDark : glyph.OnLight;
        var size = Math.Max(16, (int)Math.Round(logicalSize * dpi / 96.0));
        var key = (glyph.Code, size, color.ToArgb());

        lock (CacheGate)
        {
            if (Cache.TryGetValue(key, out var cached)) return cached;

            var bitmap = new Bitmap(size, size);
            bitmap.SetResolution(dpi, dpi);
            using (var graphics = Graphics.FromImage(bitmap))
            using (var font = new Font(FontFamily, size * 0.62f, FontStyle.Regular, GraphicsUnit.Pixel))
            using (var brush = new SolidBrush(color))
            using (var format = new StringFormat
            {
                Alignment = StringAlignment.Center,
                LineAlignment = StringAlignment.Center,
            })
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                // Anti-aliased rather than ClearType: the bitmap has an alpha channel, and
                // subpixel rendering against transparency produces colored fringes.
                graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                graphics.DrawString(glyph.Code.ToString(), font, brush, new RectangleF(0, 0, size, size), format);
            }

            Cache[key] = bitmap;
            return bitmap;
        }
    }

    /// <summary>A glyph tinted for the menu background, so it tracks the system theme.</summary>
    public static Image? Menu(Glyph glyph, int dpi) => Render(glyph, SystemColors.Menu, dpi);

    /// <summary>A glyph tinted for the control background, for buttons.</summary>
    public static Image? Button(Glyph glyph, int dpi) => Render(glyph, SystemColors.Control, dpi);

    private static string? FirstInstalled(params string[] families)
    {
        foreach (var family in families)
        {
            try
            {
                using var probe = new Font(family, 12f);
                // WinForms silently substitutes a default face for a missing family rather than
                // throwing, so compare what came back instead of trusting the constructor.
                if (string.Equals(probe.Name, family, StringComparison.OrdinalIgnoreCase)) return family;
            }
            catch (ArgumentException)
            {
                // Not installed; try the next one.
            }
        }
        return null;
    }
}
