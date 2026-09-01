using System.Drawing;
using JobTrack.Host.Config;
using JobTrack.Host.Hosting;

namespace JobTrack.Host.UI;

/// <summary>
/// A read-only view of the two log files.
/// </summary>
/// <remarks>
/// With no console, the logs are the only account of what happened, and "click here to see the
/// log" is the useful half of an error balloon. Opening them in Notepad would work, but a
/// refreshable window that already knows where they are is a better answer to "it isn't working"
/// than asking someone to go and find a directory.
/// </remarks>
internal sealed class LogWindow : Form
{
    private const int TailLines = 500;

    private readonly RollingLog _hostLog;
    private readonly RollingLog _serverLog;
    private readonly TextBox _text;
    private readonly ComboBox _which;

    public LogWindow(RollingLog hostLog, RollingLog serverLog)
    {
        _hostLog = hostLog;
        _serverLog = serverLog;

        Text = "JobTrack log";
        Icon = Icons.App;
        Size = new Size(900, 560);
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(500, 300);

        _text = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Both,
            WordWrap = false,
            Dock = DockStyle.Fill,
            Font = new Font("Consolas", 9f),
            BackColor = SystemColors.Window,
            BorderStyle = BorderStyle.FixedSingle,
        };

        _which = new ComboBox
        {
            DropDownStyle = ComboBoxStyle.DropDownList,
            Width = 150,
            // Nudged down so the combo's text baseline lines up with the buttons beside it: a
            // ComboBox is a couple of pixels shorter than an AutoSize Button.
            Margin = new Padding(0, 1, 12, 0),
        };
        _which.Items.AddRange(["Server", "Host"]);
        _which.SelectedIndex = 0;
        _which.SelectedIndexChanged += (_, _) => Refresh(scrollToEnd: true);

        var toolbar = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            WrapContents = false,
            // The bottom inset is the point: without it the buttons sit flush against the log,
            // and the two read as one crowded block rather than a toolbar above its content.
            Padding = new Padding(10, 10, 10, 10),
        };
        toolbar.Controls.Add(_which);
        toolbar.Controls.Add(Button("Refresh", Glyphs.Refresh, (_, _) => Refresh(scrollToEnd: true)));
        toolbar.Controls.Add(Button("Copy", Glyphs.Copy, (_, _) => Shell.TrySetClipboard(_text.Text)));
        toolbar.Controls.Add(Button("Open folder", Glyphs.Folder, (_, _) => Shell.OpenFolder(Paths.LogDir)));

        // The text box gets its own padded container rather than filling the form edge to edge,
        // so the log sits in the window instead of being welded to its frame.
        var body = new Panel { Dock = DockStyle.Fill, Padding = new Padding(10, 0, 10, 10) };
        body.Controls.Add(_text);

        Controls.Add(body);
        Controls.Add(toolbar);
        Refresh(scrollToEnd: true);
    }

    private Button Button(string text, Glyph glyph, EventHandler onClick)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Image = Glyphs.Button(glyph, DeviceDpi),
            ImageAlign = ContentAlignment.MiddleLeft,
            TextAlign = ContentAlignment.MiddleRight,
            TextImageRelation = TextImageRelation.ImageBeforeText,
            Padding = new Padding(8, 5, 10, 5),
            Margin = new Padding(0, 0, 8, 0),
            // Standard, not System: a System-styled button is drawn by the OS and ignores
            // the Image property entirely, so the glyphs would silently not appear.
            FlatStyle = FlatStyle.Standard,
        };
        button.Click += onClick;
        return button;
    }

    private void Refresh(bool scrollToEnd)
    {
        var log = _which.SelectedIndex == 1 ? _hostLog : _serverLog;
        _text.Text = log.Tail(TailLines);
        if (!scrollToEnd) return;
        _text.SelectionStart = _text.TextLength;
        _text.ScrollToCaret();
    }
}
