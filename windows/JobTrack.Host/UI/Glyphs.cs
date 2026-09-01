using System.Drawing;
using System.Drawing.Drawing2D;

namespace JobTrack.Host.UI;

/// <summary>
/// One menu or button icon: how to draw it, and the hue it is drawn in.
/// </summary>
/// <param name="Paint">Draws the icon into <see cref="IconCanvas"/>'s 32-unit grid.</param>
/// <param name="OnLight">The hue to use against a light surface.</param>
/// <param name="OnDark">The same hue, lifted for a dark surface.</param>
internal readonly record struct Glyph(Action<IconCanvas> Paint, Color OnLight, Color OnDark);

/// <summary>
/// Menu and button icons: small moulded objects, drawn at whatever size and theme the caller needs.
/// </summary>
/// <remarks>
/// <see cref="IconArt"/> holds the shapes and the lighting. What is here is the palette, the cache,
/// and the one piece of rendering that has nothing to do with what an icon looks like: drawing it
/// three times oversize and scaling it down. That is not a nicety. These are curved, graded objects
/// at 16 or 20 pixels, and GDI+ anti-aliasing alone leaves the gear's teeth and the folder's
/// diagonal visibly stepped; supersampling settles them, for the cost of a bitmap thrown away
/// immediately afterwards.
///
/// Two values per hue rather than one, because a menu can be light or dark and one blue cannot
/// serve both. <see cref="Render"/> picks between them from the surface the icon will sit on, so
/// the set follows the system theme with nothing to configure.
/// </remarks>
internal static class Glyphs
{
    // Saturated enough to survive being shaded -- Volume lightens the top of a shape and darkens
    // its base, so a hue that starts out muted arrives on screen as gray.
    private static readonly Color Blue = Color.FromArgb(0x1E, 0x74, 0xD0);
    private static readonly Color BlueLift = Color.FromArgb(0x4C, 0x9B, 0xEC);
    private static readonly Color Gold = Color.FromArgb(0xE8, 0xA5, 0x22);
    private static readonly Color GoldLift = Color.FromArgb(0xF2, 0xBA, 0x4E);
    private static readonly Color Green = Color.FromArgb(0x2C, 0xA5, 0x46);
    private static readonly Color GreenLift = Color.FromArgb(0x55, 0xC5, 0x6D);
    private static readonly Color Red = Color.FromArgb(0xD6, 0x35, 0x3A);
    private static readonly Color RedLift = Color.FromArgb(0xEA, 0x63, 0x67);
    private static readonly Color Purple = Color.FromArgb(0x91, 0x4E, 0xCC);
    private static readonly Color PurpleLift = Color.FromArgb(0xB0, 0x7F, 0xE2);
    private static readonly Color Teal = Color.FromArgb(0x12, 0x96, 0xA2);
    private static readonly Color TealLift = Color.FromArgb(0x3E, 0xBC, 0xC8);

    public static readonly Glyph Open = new(IconArt.Window, Blue, BlueLift);
    // The gear's own body is steel; the hue is the hub it turns on.
    public static readonly Glyph Settings = new(IconArt.Gear, Blue, BlueLift);
    public static readonly Glyph Copy = new(IconArt.Copy, Blue, BlueLift);
    public static readonly Glyph Code = new(IconArt.Braces, Purple, PurpleLift);
    public static readonly Glyph Folder = new(IconArt.Folder, Gold, GoldLift);
    public static readonly Glyph Document = new(IconArt.Page, Blue, BlueLift);
    public static readonly Glyph Refresh = new(IconArt.Refresh, Green, GreenLift);
    public static readonly Glyph Power = new(IconArt.Power, Red, RedLift);
    public static readonly Glyph Lock = new(IconArt.Lock, Teal, TealLift);
    public static readonly Glyph Eye = new(IconArt.Eye, Blue, BlueLift);
    public static readonly Glyph Save = new(IconArt.Save, Blue, BlueLift);
    public static readonly Glyph Cancel = new(IconArt.Cross, Red, RedLift);

    /// <summary>How much oversize each icon is drawn before being scaled down.</summary>
    private const int Supersample = 3;

    private static readonly Dictionary<(Action<IconCanvas> Paint, int Size, bool Dark), Image> Cache = [];
    private static readonly Lock CacheGate = new();

    /// <summary>
    /// An icon at the size a menu or toolbar wants for the given DPI, lit for the surface it is
    /// going to sit on.
    /// </summary>
    public static Image Render(Glyph glyph, Color surface, int dpi = 96, int logicalSize = 16)
    {
        var onDark = surface.GetBrightness() < 0.5f;
        var size = Math.Max(16, (int)Math.Round(logicalSize * dpi / 96.0));
        var key = (glyph.Paint, size, onDark);

        lock (CacheGate)
        {
            if (Cache.TryGetValue(key, out var cached)) return cached;

            var bitmap = new Bitmap(size, size);
            bitmap.SetResolution(dpi, dpi);

            var large = size * Supersample;
            using (var oversize = new Bitmap(large, large))
            {
                using (var graphics = Graphics.FromImage(oversize))
                {
                    graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    // Everything in IconArt is written in a 32x32 grid; this is the only place
                    // that knows the size it is really being drawn at.
                    graphics.ScaleTransform(large / IconCanvas.Grid, large / IconCanvas.Grid);

                    var accent = onDark ? glyph.OnDark : glyph.OnLight;
                    var paper = onDark ? Color.FromArgb(0xE4, 0xEA, 0xF2) : Color.FromArgb(0xFB, 0xFC, 0xFE);
                    glyph.Paint(new IconCanvas(graphics, accent, paper, onDark));
                }

                using var graphics2 = Graphics.FromImage(bitmap);
                graphics2.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics2.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics2.DrawImage(oversize, new Rectangle(0, 0, size, size));
            }

            Cache[key] = bitmap;
            return bitmap;
        }
    }

    /// <summary>An icon lit for the menu background, so it tracks the system theme.</summary>
    public static Image Menu(Glyph glyph, int dpi) => Render(glyph, SystemColors.Menu, dpi);

    /// <summary>An icon lit for the control background, for buttons.</summary>
    public static Image Button(Glyph glyph, int dpi) => Render(glyph, SystemColors.Control, dpi);
}
