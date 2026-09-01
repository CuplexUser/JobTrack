using System.Drawing;
using System.Drawing.Drawing2D;

namespace JobTrack.Host.UI;

/// <summary>
/// A 32x32 drawing surface with the shading that makes a flat path look like a moulded object.
/// </summary>
/// <remarks>
/// Every icon is drawn in the same 32-unit grid and scaled to whatever the menu asks for, so one
/// description serves 16px, 20px on a 125% display, and 32px.
///
/// The style is fixed here rather than per icon, which is what makes twelve separately drawn
/// objects read as one set: a body graded from a lit top to a deeper base, one specular highlight
/// up and to the left, and a soft contact shadow under the object. Almost nothing is outlined —
/// an outline is what makes an icon read as a drawing of a thing rather than as the thing — so
/// <see cref="Volume"/> defines an edge with tone, by darkening the underside just before the body
/// goes down. The one exception it makes is for near-white paper, which has no tone left to be
/// separated from a light menu by.
/// </remarks>
internal sealed class IconCanvas(Graphics graphics, Color accent, Color paper, bool onDark)
{
    public const float Grid = 32f;

    public Color Accent { get; } = accent;
    public Color Paper { get; } = paper;

    /// <summary>Steel, for the parts of an object meant to read as metal.</summary>
    public Color Metal { get; } = onDark ? Color.FromArgb(0xC2, 0xCC, 0xD6) : Color.FromArgb(0xB0, 0xBC, 0xC9);

    /// <summary>How hard the contact shadows land; a dark menu cannot take as much.</summary>
    private int ShadowAlpha { get; } = onDark ? 105 : 70;

    // ------------------------------------------------------------------------------------ shading

    /// <summary>
    /// Fills a shape as a lit solid: a dark lip below it, a body graded from top to bottom, and a
    /// specular highlight over the upper left.
    /// </summary>
    public void Volume(GraphicsPath path, Color color, float gloss = 0.55f)
    {
        var bounds = path.GetBounds();
        if (bounds.Height < 0.01f || bounds.Width < 0.01f) return;

        // The underside, offset down and drawn first, so the body's own edge covers all but a
        // sliver of it -- which is what reads as the object's own thickness.
        using (var lip = (GraphicsPath)path.Clone())
        using (var move = new Matrix())
        {
            move.Translate(0, 0.55f);
            lip.Transform(move);
            using var brush = new SolidBrush(Darken(color, 0.42f));
            graphics.FillPath(brush, lip);
        }

        // Inflated so the gradient never runs out on the top and bottom rows of pixels.
        var box = RectangleF.Inflate(bounds, 0.8f, 0.8f);
        using (var brush = new LinearGradientBrush(box, Lighten(color, 0.30f), Darken(color, 0.27f), LinearGradientMode.Vertical))
        {
            brush.SetBlendTriangularShape(0.58f, 1f);
            graphics.FillPath(brush, path);
        }

        // A near-white object on a light menu has no tone left to define it with, so paper --
        // and only paper -- gets a real edge. Everything colored is separated by its own value.
        if (color.GetBrightness() > 0.82f)
        {
            using var edge = new Pen(Darken(color, 0.42f), 0.9f) { LineJoin = LineJoin.Round };
            graphics.DrawPath(edge, path);
        }

        if (gloss > 0) Sheen(path, gloss);
    }

    /// <summary>
    /// The specular highlight: a soft blob up and to the left, clipped to the body it sits on.
    /// </summary>
    public void Sheen(GraphicsPath path, float strength)
    {
        var b = path.GetBounds();
        if (b.Width < 1f || b.Height < 1f) return;

        var previous = graphics.Clip;
        graphics.SetClip(path, CombineMode.Intersect);

        using (var blob = new GraphicsPath())
        {
            blob.AddEllipse(b.X - b.Width * 0.30f, b.Y - b.Height * 0.62f, b.Width * 1.30f, b.Height * 1.16f);
            using var brush = new PathGradientBrush(blob)
            {
                CenterPoint = new PointF(b.X + b.Width * 0.34f, b.Y + b.Height * 0.06f),
                CenterColor = Color.FromArgb((int)(150 * strength), 255, 255, 255),
                SurroundColors = [Color.FromArgb(0, 255, 255, 255)],
            };
            graphics.FillPath(brush, blob);
        }

        graphics.Clip = previous;
    }

    /// <summary>
    /// What the object drops onto the surface behind it, as a stack of offset silhouettes rather
    /// than a real blur — GDI+ has no cheap blur, and at these sizes the stack passes for one.
    /// </summary>
    public void Shadow(GraphicsPath path, float spread = 1f)
    {
        var b = path.GetBounds();
        var cx = b.X + b.Width / 2f;
        var cy = b.Y + b.Height / 2f;

        for (var i = 3; i >= 1; i--)
        {
            using var layer = (GraphicsPath)path.Clone();
            using var move = new Matrix();
            // Grown about its own center as well as dropped, so the shadow spreads outward
            // instead of looking like a second copy of the object.
            move.Translate(cx, cy);
            move.Scale(1f + 0.035f * i * spread, 1f + 0.045f * i * spread);
            move.Translate(-cx, -cy + 0.5f * i * spread);
            layer.Transform(move);
            using var brush = new SolidBrush(Color.FromArgb(ShadowAlpha / 4, 0, 0, 0));
            graphics.FillPath(brush, layer);
        }
    }

    /// <summary>A sphere-lit circle: the treatment for anything round.</summary>
    public void Orb(float cx, float cy, float r, Color color)
    {
        using var path = new GraphicsPath();
        path.AddEllipse(cx - r, cy - r, r * 2, r * 2);
        using (var brush = new PathGradientBrush(path)
        {
            CenterPoint = new PointF(cx - r * 0.42f, cy - r * 0.46f),
            CenterColor = Lighten(color, 0.62f),
            SurroundColors = [Darken(color, 0.22f)],
        })
        {
            graphics.FillPath(brush, path);
        }
        Sheen(path, 0.5f);
    }

    // -------------------------------------------------------------------------------------- shapes

    public void Solid(GraphicsPath path, Color color)
    {
        using var brush = new SolidBrush(color);
        graphics.FillPath(brush, path);
    }

    public void Solid(Color color, params PointF[] points)
    {
        using var brush = new SolidBrush(color);
        graphics.FillPolygon(brush, points);
    }

    /// <summary>A flat filled circle, for the small details that carry no shading of their own.</summary>
    public void Dot(Color color, float cx, float cy, float r)
    {
        using var brush = new SolidBrush(color);
        graphics.FillEllipse(brush, cx - r, cy - r, r * 2, r * 2);
    }

    /// <summary>A flat filled rounded rectangle.</summary>
    public void Slab(Color color, float x, float y, float w, float h, float r)
    {
        using var path = Rounded(x, y, w, h, r);
        Solid(path, color);
    }

    /// <summary>A stroke moulded like everything else, for the icons whose subject is a line.</summary>
    public void Bar(Color color, float width, params PointF[] points)
    {
        using var path = new GraphicsPath();
        path.AddLines(points);
        Mould(path, color, width);
    }

    public void ArcBar(Color color, float width, float cx, float cy, float r, float start, float sweep)
    {
        using var path = new GraphicsPath();
        path.AddArc(cx - r, cy - r, r * 2, r * 2, start, sweep);
        Mould(path, color, width);
    }

    private void Mould(GraphicsPath line, Color color, float width)
    {
        using var pen = new Pen(color, width) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
        line.Widen(pen);
        Shadow(line, 0.7f);
        Volume(line, color, 0.5f);
    }

    public static GraphicsPath Poly(params PointF[] points)
    {
        var path = new GraphicsPath();
        path.AddPolygon(points);
        return path;
    }

    public static GraphicsPath Rounded(float x, float y, float w, float h, float r)
    {
        var path = new GraphicsPath();
        if (r <= 0)
        {
            path.AddRectangle(new RectangleF(x, y, w, h));
            return path;
        }

        var d = r * 2;
        path.AddArc(x, y, d, d, 180, 90);
        path.AddArc(x + w - d, y, d, d, 270, 90);
        path.AddArc(x + w - d, y + h - d, d, d, 0, 90);
        path.AddArc(x, y + h - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    /// <summary>The point <paramref name="degrees"/> around a circle, for placing arrowheads.</summary>
    public static PointF Polar(float cx, float cy, float r, float degrees)
    {
        var radians = degrees * MathF.PI / 180f;
        return new PointF(cx + r * MathF.Cos(radians), cy + r * MathF.Sin(radians));
    }

    public static Color Lighten(Color c, float amount) => Color.FromArgb(c.A,
        (int)(c.R + (255 - c.R) * amount), (int)(c.G + (255 - c.G) * amount), (int)(c.B + (255 - c.B) * amount));

    public static Color Darken(Color c, float amount) => Color.FromArgb(c.A,
        (int)(c.R * (1 - amount)), (int)(c.G * (1 - amount)), (int)(c.B * (1 - amount)));
}

/// <summary>
/// The twelve icons, drawn as lit objects rather than taken from a font.
/// </summary>
/// <remarks>
/// Segoe Fluent Icons and Segoe MDL2 Assets are outline faces: at menu size every glyph is a
/// one-pixel stroke, and coloring a one-pixel stroke changes almost nothing on screen. Measuring
/// the font settled whether a filled set could be assembled from it instead — of its ~2,500
/// glyphs only about 130 are filled, and none of those is a folder, a padlock, a power symbol, a
/// refresh arrow, a copy or an eye.
///
/// So each icon is a handful of paths handed to <see cref="IconCanvas"/> to be lit. The detail is
/// deliberately coarse: anything finer than about a third of the icon's width is mud once it is
/// drawn at 16 pixels, which is where most of these actually live.
/// </remarks>
internal static class IconArt
{
    /// <summary>A browser window: the thing "Open JobTrack" actually opens.</summary>
    public static void Window(IconCanvas c)
    {
        using var body = IconCanvas.Rounded(2.4f, 3.8f, 27.2f, 24.4f, 3.4f);
        c.Shadow(body);
        c.Volume(body, c.Accent, 0.42f);

        using var screen = IconCanvas.Rounded(5.2f, 11.4f, 21.6f, 14.4f, 1.6f);
        c.Volume(screen, c.Paper, 0.5f);

        var chrome = IconCanvas.Lighten(c.Accent, 0.72f);
        c.Dot(chrome, 6.8f, 7.6f, 1.3f);
        c.Dot(chrome, 10.7f, 7.6f, 1.3f);
        c.Dot(chrome, 14.6f, 7.6f, 1.3f);

        c.Slab(IconCanvas.Lighten(c.Accent, 0.12f), 7.8f, 14.8f, 15f, 2.3f, 1.15f);
        c.Slab(IconCanvas.Lighten(c.Accent, 0.38f), 7.8f, 19.6f, 9.8f, 2.3f, 1.15f);
    }

    /// <summary>A steel cog turning on a colored hub.</summary>
    public static void Gear(IconCanvas c)
    {
        const float cx = 16f, cy = 16f;
        using var cog = new GraphicsPath { FillMode = FillMode.Alternate };
        const int count = 6;
        var teeth = new PointF[count * 4];
        for (var i = 0; i < teeth.Length; i++)
        {
            // Four points per tooth: up the flank, across the top, down, across the valley.
            var quarter = i % 4;
            var radius = quarter is 1 or 2 ? 15f : 10.6f;
            var degrees = i * (360f / teeth.Length) + (quarter is 0 or 3 ? 7.5f : -7.5f);
            teeth[i] = IconCanvas.Polar(cx, cy, radius, degrees);
        }
        cog.AddPolygon(teeth);
        cog.AddEllipse(cx - 6.6f, cy - 6.6f, 13.2f, 13.2f);

        c.Shadow(cog, 1.2f);
        c.Volume(cog, c.Metal, 0.6f);
        c.Orb(cx, cy, 7f, c.Accent);
        c.Dot(IconCanvas.Darken(c.Accent, 0.52f), cx, cy, 3.2f);
    }

    /// <summary>A padlock, closed, on a steel shackle.</summary>
    public static void Lock(IconCanvas c)
    {
        using var shackle = new GraphicsPath();
        shackle.AddArc(9.8f, 4.2f, 12.4f, 12.4f, 180, 180);
        using (var wire = new Pen(c.Metal, 3.4f) { StartCap = LineCap.Flat, EndCap = LineCap.Flat })
        {
            shackle.Widen(wire);
        }
        c.Shadow(shackle, 0.7f);
        c.Volume(shackle, c.Metal, 0.62f);

        using var body = IconCanvas.Rounded(5f, 13.4f, 22f, 16.4f, 3.4f);
        c.Shadow(body);
        c.Volume(body, c.Accent, 0.5f);

        using var keyhole = new GraphicsPath();
        keyhole.AddEllipse(13.9f, 17.8f, 4.2f, 4.2f);
        keyhole.AddPolygon(new[] { new PointF(14.8f, 20.2f), new PointF(17.2f, 20.2f), new PointF(18.1f, 26f), new PointF(13.9f, 26f) });
        c.Solid(keyhole, IconCanvas.Darken(c.Accent, 0.52f));
    }

    /// <summary>Braces: the MCP client config is a block of JSON.</summary>
    public static void Braces(IconCanvas c)
    {
        Brace(c, left: true);
        Brace(c, left: false);
    }

    private static void Brace(IconCanvas c, bool left)
    {
        // Drawn as a curve rather than a font's "{": at this size a real brace's thin waist
        // disappears, and this keeps an even weight all the way round.
        var sign = left ? 1f : -1f;
        var x = left ? 0f : 32f;
        using var path = new GraphicsPath();
        path.AddCurve(
        [
            new PointF(x + sign * 12.4f, 4.6f), new PointF(x + sign * 7.6f, 7.4f), new PointF(x + sign * 8.4f, 13.2f),
            new PointF(x + sign * 4.4f, 16f),
            new PointF(x + sign * 8.4f, 18.8f), new PointF(x + sign * 7.6f, 24.6f), new PointF(x + sign * 12.4f, 27.4f),
        ], 0.5f);
        using (var pen = new Pen(c.Accent, 3.4f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
        {
            path.Widen(pen);
        }
        c.Shadow(path, 0.7f);
        c.Volume(path, c.Accent, 0.55f);
    }

    /// <summary>A folder, front panel standing off the back one.</summary>
    public static void Folder(IconCanvas c)
    {
        using var back = IconCanvas.Poly(
            new PointF(2.2f, 5f), new PointF(12.2f, 5f), new PointF(14.8f, 8.8f), new PointF(29.8f, 8.8f),
            new PointF(29.8f, 24.4f), new PointF(2.2f, 24.4f));
        c.Shadow(back, 1.2f);
        c.Volume(back, IconCanvas.Darken(c.Accent, 0.26f), 0.45f);

        using var front = IconCanvas.Poly(
            new PointF(4.8f, 11.8f), new PointF(30.6f, 11.8f), new PointF(27f, 28.4f), new PointF(1.4f, 28.4f));
        c.Shadow(front, 0.8f);
        c.Volume(front, c.Accent, 0.5f);
    }

    /// <summary>A sheet of paper with a folded corner and three lines of writing.</summary>
    public static void Page(IconCanvas c)
    {
        using var page = Sheet(6.6f, 2.4f, 19, 27.2f);
        c.Shadow(page);
        c.Volume(page, c.Paper, 0.45f);
        c.Solid(IconCanvas.Darken(c.Paper, 0.22f),
            new PointF(19.6f, 2.4f), new PointF(25.6f, 8.4f), new PointF(19.6f, 8.4f));

        Line(c, 10.2f, 13f, 11.4f);
        Line(c, 10.2f, 17f, 11.4f);
        Line(c, 10.2f, 21f, 7.6f);
    }

    /// <summary>Two sheets, the front one lifted off the back one.</summary>
    public static void Copy(IconCanvas c)
    {
        using var back = IconCanvas.Rounded(5.4f, 2.6f, 14.6f, 18.6f, 1.6f);
        c.Shadow(back);
        c.Volume(back, IconCanvas.Darken(c.Paper, 0.14f), 0.4f);
        Line(c, 8.2f, 7f, 8.8f);
        Line(c, 8.2f, 10.6f, 8.8f);

        using var front = Sheet(11.4f, 9.4f, 15.2f, 20);
        c.Shadow(front, 1.3f);
        c.Volume(front, c.Paper, 0.45f);
        c.Solid(IconCanvas.Darken(c.Paper, 0.22f),
            new PointF(21.6f, 9.4f), new PointF(26.6f, 14.4f), new PointF(21.6f, 14.4f));
        Line(c, 14f, 18.4f, 8.8f);
        Line(c, 14f, 22.2f, 6f);
    }

    /// <summary>A circular arrow, for restart and regenerate.</summary>
    public static void Refresh(IconCanvas c)
    {
        const float cx = 16f, cy = 16.4f, r = 9.4f, start = 42f, sweep = 262f;
        c.ArcBar(c.Accent, 3.7f, cx, cy, r, start, sweep);

        // The head is built from the arc's own end point and tangent, so the two cannot drift
        // apart when the geometry is nudged -- and a head that is merely near the end, pointing
        // roughly the right way, is exactly what makes a refresh arrow read as a letter G.
        var end = start + sweep;
        var radians = end * MathF.PI / 180f;
        var along = new PointF(-MathF.Sin(radians), MathF.Cos(radians));
        var across = new PointF(-along.Y, along.X);
        var seat = IconCanvas.Polar(cx, cy, r, end);
        PointF At(float forward, float side) =>
            new(seat.X + along.X * forward + across.X * side, seat.Y + along.Y * forward + across.Y * side);

        using var head = IconCanvas.Poly(At(5.4f, 0), At(-2.4f, 4.6f), At(-2.4f, -4.6f));
        c.Shadow(head, 0.8f);
        c.Volume(head, c.Accent, 0.55f);
    }

    /// <summary>The power symbol: a broken ring with a bar standing in the gap.</summary>
    public static void Power(IconCanvas c)
    {
        c.ArcBar(c.Accent, 3.8f, 16, 17.6f, 9.4f, 303, 294);
        c.Bar(c.Accent, 3.8f, new PointF(16, 5.2f), new PointF(16, 14.8f));
    }

    /// <summary>A floppy disk. Nobody has one; everybody knows it means save.</summary>
    public static void Save(IconCanvas c)
    {
        using var body = new GraphicsPath();
        body.AddPolygon(new[]
        {
            new PointF(2.8f, 3.6f), new PointF(2.8f, 28.4f), new PointF(29.2f, 28.4f),
            new PointF(29.2f, 10f), new PointF(22.8f, 3.6f),
        });
        c.Shadow(body);
        c.Volume(body, c.Accent, 0.42f);

        using var shutter = IconCanvas.Rounded(9.4f, 3.6f, 11f, 9.2f, 0.7f);
        c.Volume(shutter, c.Metal, 0.55f);
        c.Slab(IconCanvas.Darken(c.Metal, 0.5f), 16.4f, 5.2f, 2.8f, 6f, 0.5f);

        using var label = IconCanvas.Rounded(7.6f, 17f, 16.8f, 11.4f, 1f);
        c.Volume(label, c.Paper, 0.5f);
        Line(c, 9.8f, 19.8f, 12.4f);
        Line(c, 9.8f, 23.2f, 8.8f);
    }

    /// <summary>An eye, for revealing a masked field.</summary>
    public static void Eye(IconCanvas c)
    {
        using var almond = new GraphicsPath();
        almond.AddBezier(2.8f, 16, 9.4f, 7.8f, 22.6f, 7.8f, 29.2f, 16);
        almond.AddBezier(29.2f, 16, 22.6f, 24.2f, 9.4f, 24.2f, 2.8f, 16);
        c.Shadow(almond, 0.8f);
        c.Volume(almond, c.Paper, 0.55f);

        c.Orb(16, 16, 5.6f, c.Accent);
        c.Dot(IconCanvas.Darken(c.Accent, 0.7f), 16, 16, 2.5f);
        c.Dot(Color.FromArgb(205, 255, 255, 255), 13.9f, 13.9f, 1.5f);
    }

    /// <summary>A cross, for cancel.</summary>
    public static void Cross(IconCanvas c)
    {
        c.Bar(c.Accent, 4.2f, new PointF(9f, 9f), new PointF(23f, 23f));
        c.Bar(c.Accent, 4.2f, new PointF(23f, 9f), new PointF(9f, 23f));
    }

    /// <summary>A page outline with the top-right corner turned down.</summary>
    private static GraphicsPath Sheet(float x, float y, float w, float h)
    {
        const float fold = 6f;
        var path = new GraphicsPath();
        path.AddPolygon(new[]
        {
            new PointF(x, y), new PointF(x + w - fold, y), new PointF(x + w, y + fold),
            new PointF(x + w, y + h), new PointF(x, y + h),
        });
        return path;
    }

    /// <summary>A line of writing on a sheet, in the icon's own hue.</summary>
    private static void Line(IconCanvas c, float x, float y, float w)
    {
        c.Slab(c.Accent, x, y, w, 1.8f, 0.9f);
    }
}
