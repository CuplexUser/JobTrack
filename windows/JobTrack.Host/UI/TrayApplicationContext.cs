using JobTrack.Host.Config;
using JobTrack.Host.Hosting;

namespace JobTrack.Host.UI;

/// <summary>
/// The tray icon: the only user interface JobTrack has when it is behaving.
/// </summary>
/// <remarks>
/// A native <see cref="NotifyIcon"/> rather than the <c>systray</c> package the npm build uses.
/// That package works, but it costs a second process (a Go binary copied out of node_modules on
/// every start), 35 MB of tray executables for three platforms, and it can only show a fixed menu
/// — no balloon notifications, no menu items that enable and disable as the server's state
/// changes. Since the payload deletes it, this is also what makes that 35 MB saving possible.
/// </remarks>
internal sealed class TrayApplicationContext : ApplicationContext
{
    private readonly NodeSupervisor _supervisor;
    private readonly LaunchManifest _manifest;
    private readonly SingleInstance _instance;
    private readonly RollingLog _hostLog;
    private readonly RollingLog _serverLog;
    private readonly HostSettings _settings = HostSettings.Load();

    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _header;
    private readonly ToolStripMenuItem _open;
    private readonly ToolStripMenuItem _settingsItem;
    private readonly ToolStripMenuItem _copyToken;
    private readonly ToolStripMenuItem _copyMcp;
    private readonly ToolStripMenuItem _restart;

    /// <summary>Marshals supervisor callbacks, which arrive on background threads, onto the UI thread.</summary>
    private readonly Control _sync = new();

    private SettingsForm? _settingsForm;
    private bool _quitting;

    public TrayApplicationContext(
        NodeSupervisor supervisor,
        LaunchManifest manifest,
        SingleInstance instance,
        RollingLog hostLog,
        RollingLog serverLog,
        bool launchedAtSignIn)
    {
        _supervisor = supervisor;
        _manifest = manifest;
        _instance = instance;
        _hostLog = hostLog;
        _serverLog = serverLog;
        _ = _sync.Handle; // Force handle creation now, while we are on the UI thread.

        _header = new ToolStripMenuItem($"JobTrack {VersionInfo.Host}") { Enabled = false };
        _open = new ToolStripMenuItem("&Open JobTrack", null, (_, _) => OpenUi()) { Enabled = false };
        _settingsItem = new ToolStripMenuItem("&Settings...", null, (_, _) => ShowSettings());
        _copyToken = new ToolStripMenuItem("Copy &API token", null, (_, _) => CopyApiToken());
        _copyMcp = new ToolStripMenuItem("Copy &MCP client config", null, (_, _) => CopyMcpConfig())
        {
            // Only meaningful when the payload actually bundled the MCP server.
            Available = manifest.McpEntry is { Length: > 0 },
        };
        _restart = new ToolStripMenuItem("&Restart server", null, async (_, _) => await _supervisor.RestartAsync());

        var menu = new ContextMenuStrip();
        menu.Items.AddRange(
        [
            _header,
            _open,
            new ToolStripSeparator(),
            _settingsItem,
            _copyToken,
            _copyMcp,
            new ToolStripMenuItem("Open &data folder", null, (_, _) => Shell.OpenFolder(Paths.JobtrackHome)),
            new ToolStripMenuItem("&View log", null, (_, _) => ShowLog()),
            new ToolStripSeparator(),
            _restart,
            new ToolStripMenuItem("&Quit", null, async (_, _) => await QuitAsync()),
        ]);

        _icon = new NotifyIcon
        {
            Icon = Icons.App,
            Text = "JobTrack — starting...",
            Visible = true,
            ContextMenuStrip = menu,
        };
        // Double-click is what people try first, so it does the obvious thing.
        _icon.DoubleClick += (_, _) => OpenUi();
        _icon.BalloonTipClicked += (_, _) => OnBalloonClicked();

        _instance.ShowRequested += () => Post(OpenUi);
        _instance.QuitRequested += () => Post(() => _ = QuitAsync());
        _instance.BeginListening();

        _supervisor.StateChanged += state => Post(() => OnStateChanged(state, launchedAtSignIn));
        _supervisor.Start();

        ShowFirstRunHintIfNeeded();
    }

    /// <summary>Runs an action on the UI thread, from wherever it was called.</summary>
    private void Post(Action action)
    {
        if (_sync.IsDisposed) return;
        try
        {
            if (_sync.InvokeRequired) _sync.BeginInvoke(action);
            else action();
        }
        catch (ObjectDisposedException)
        {
            // Shutting down; there is no UI left to update.
        }
    }

    private void OnStateChanged(ServerState state, bool launchedAtSignIn)
    {
        var ready = _supervisor.Ready;
        _open.Enabled = state == ServerState.Running;
        _restart.Enabled = state != ServerState.Stopped;

        _icon.Text = state switch
        {
            ServerState.Starting => "JobTrack — starting...",
            ServerState.Restarting => "JobTrack — restarting...",
            // NotifyIcon.Text is capped at 63 characters, which the URL comfortably fits inside.
            ServerState.Running => $"JobTrack {ready?.Version} — {ready?.Url}",
            ServerState.Failed => "JobTrack — not running",
            _ => "JobTrack — stopped",
        };
        if (ready is not null) _header.Text = $"JobTrack {ready.Version} ({ready.Driver})";

        switch (state)
        {
            case ServerState.Running when _settings.OpenBrowserOnStart && !launchedAtSignIn:
                OpenUi();
                break;

            case ServerState.Failed when _supervisor.LastError is { Code: "EADDRINUSE" } portError:
                // The overwhelmingly likely cause is a second JobTrack — very often an
                // npm-installed one. Restart-looping into a taken port helps nobody; offering the
                // two things a person might actually want to do does.
                Notify("JobTrack is already running",
                    $"Something is already using port {portError.Port}. Click here to open it, or change the port in Settings.",
                    ToolTipIcon.Warning, BalloonAction.OpenExistingServer);
                break;

            case ServerState.Failed:
                Notify("JobTrack could not start", "Click here to see the log.", ToolTipIcon.Error, BalloonAction.ShowLog);
                break;
        }
    }

    private enum BalloonAction { None, ShowLog, OpenExistingServer }

    private BalloonAction _balloonAction = BalloonAction.None;

    private void Notify(string title, string message, ToolTipIcon icon, BalloonAction action)
    {
        _balloonAction = action;
        _icon.ShowBalloonTip(10_000, title, message, icon);
    }

    private void OnBalloonClicked()
    {
        switch (_balloonAction)
        {
            case BalloonAction.ShowLog:
                ShowLog();
                break;
            case BalloonAction.OpenExistingServer:
                // Whatever holds the port, this is the address it is on.
                var port = _supervisor.LastError?.Port ?? 3001;
                Shell.OpenUrl($"http://127.0.0.1:{port}");
                break;
        }
        _balloonAction = BalloonAction.None;
    }

    private void ShowFirstRunHintIfNeeded()
    {
        if (_settings.FirstRunShown) return;
        _settings.FirstRunShown = true;
        _settings.Save();
        // Windows 11 hides new notification-area icons by default, so without this the app looks
        // like it did nothing at all.
        Notify("JobTrack is running", "It lives in the notification area — you may want to pin it there.",
            ToolTipIcon.Info, BalloonAction.None);
    }

    private void OpenUi()
    {
        var url = _supervisor.Ready?.Url;
        if (url is null)
        {
            Notify("JobTrack is still starting", "The window will open as soon as the server is ready.",
                ToolTipIcon.Info, BalloonAction.None);
            return;
        }
        Shell.OpenUrl(url);
    }

    private void ShowSettings()
    {
        if (_settingsForm is { IsDisposed: false })
        {
            _settingsForm.Activate();
            return;
        }
        _settingsForm = new SettingsForm(_supervisor, _manifest, _settings);
        _settingsForm.FormClosed += (_, _) => _settingsForm = null;
        _settingsForm.Show();
    }

    private void ShowLog() => new LogWindow(_hostLog, _serverLog).Show();

    private void CopyApiToken()
    {
        var env = EnvFile.Load(Paths.EnvFile, _manifest.EnvExample is { } example ? Paths.Resolve(example) : null);
        var token = ApiToken.Read(env);
        if (token is null)
        {
            MessageBox.Show(
                "JobTrack has not generated an API token yet. It is written the first time the server starts.",
                "JobTrack", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (Shell.TrySetClipboard(token))
        {
            Notify("API token copied", "Paste it into the JobTrack Clipper extension's options page.",
                ToolTipIcon.Info, BalloonAction.None);
        }
    }

    private void CopyMcpConfig()
    {
        if (Shell.TrySetClipboard(McpConfig.Build(_manifest)))
        {
            Notify("MCP configuration copied", "Paste it into your MCP client's config file.",
                ToolTipIcon.Info, BalloonAction.None);
        }
    }

    private async Task QuitAsync()
    {
        if (_quitting) return;
        _quitting = true;
        _hostLog.Write("quitting");
        _icon.Text = "JobTrack — stopping...";
        await _supervisor.StopAsync();
        _icon.Visible = false;
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _icon.Visible = false;
            _icon.Dispose();
            _sync.Dispose();
        }
        base.Dispose(disposing);
    }
}
