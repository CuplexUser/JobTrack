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
        };

        _which = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 160 };
        _which.Items.AddRange(["Server", "Host"]);
        _which.SelectedIndex = 0;
        _which.SelectedIndexChanged += (_, _) => Refresh(scrollToEnd: true);

        var toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 36, Padding = new Padding(6, 6, 6, 0) };
        toolbar.Controls.Add(_which);
        toolbar.Controls.Add(Button("Refresh", (_, _) => Refresh(scrollToEnd: true)));
        toolbar.Controls.Add(Button("Copy", (_, _) => Shell.TrySetClipboard(_text.Text)));
        toolbar.Controls.Add(Button("Open folder", (_, _) => Shell.OpenFolder(Paths.LogDir)));

        Controls.Add(_text);
        Controls.Add(toolbar);
        Refresh(scrollToEnd: true);
    }

    private static Button Button(string text, EventHandler onClick)
    {
        var button = new Button { Text = text, AutoSize = true };
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
