using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using H.NotifyIcon;
using H.NotifyIcon.Core;
using JobTrack.Host.Config;
using JobTrack.Host.Hosting;
using JobTrack.Host.Localization;
using JobTrack.Host.Resources;
using JobTrack.Host.UI.Settings;
using JobTrack.Host.Updates;
using Wpf.Ui.Appearance;
using Wpf.Ui.Controls;
using MenuItem = System.Windows.Controls.MenuItem;
using TextBlock = System.Windows.Controls.TextBlock;

namespace JobTrack.Host.UI;

/// <summary>
/// The tray icon: the only user interface JobTrack has when it is behaving.
/// </summary>
/// <remarks>
/// A native tray icon rather than the <c>systray</c> package the npm build uses. That package
/// works, but it costs a second process (a Go binary copied out of node_modules on every start),
/// 35 MB of tray executables for three platforms, and it can only show a fixed menu — no
/// notifications, no menu items that enable and disable as the server's state changes. Since the
/// payload deletes it, this is also what makes that 35 MB saving possible.
///
/// The menu is a WPF context menu styled by WPF-UI, not a Win32 popup menu, so it has the same
/// rounded Fluent look, theme and icons as the settings window.
/// </remarks>
internal sealed class TrayController : IDisposable
{
    private readonly NodeSupervisor _supervisor;
    private readonly LaunchManifest _manifest;
    private readonly SingleInstance _instance;
    private readonly RollingLog _hostLog;
    private readonly RollingLog _serverLog;
    private readonly HostSettings _settings;
    private readonly LaunchReason _launch;
    private readonly Dispatcher _dispatcher = Dispatcher.CurrentDispatcher;
    private readonly LanguageSync _languageSync;

    private readonly TaskbarIcon _icon;
    private readonly TextBlock _headerTitle = new() { FontWeight = FontWeights.SemiBold, FontSize = 14 };
    private readonly TextBlock _headerStatus = new() { FontSize = 12, Margin = new Thickness(0, 1, 0, 0) };
    private readonly System.Windows.Shapes.Ellipse _statusDot = new() { Width = 8, Height = 8, Margin = new Thickness(0, 1, 6, 0) };
    private readonly MenuItem _open;
    private readonly MenuItem _copyMcp;
    private readonly MenuItem _update;
    private readonly MenuItem _restart;

    private readonly ReminderPoller _reminders;
    private readonly BackupClient _backups;
    private readonly UpdateService _updates;

    private SettingsWindow? _settingsWindow;
    private LogWindow? _logWindow;
    private Version? _announcedUpdate;
    private bool _checkRequestedFromMenu;
    private bool _quitting;

    public TrayController(
        NodeSupervisor supervisor,
        LaunchManifest manifest,
        SingleInstance instance,
        HostSettings settings,
        RollingLog hostLog,
        RollingLog serverLog,
        LaunchReason launch)
    {
        _supervisor = supervisor;
        _manifest = manifest;
        _instance = instance;
        _settings = settings;
        _hostLog = hostLog;
        _serverLog = serverLog;
        _launch = launch;
        _languageSync = new LanguageSync(ReadApiToken, hostLog);

        _open = Item(Strings.Get("tray.open"), SymbolRegular.Open24, OpenUi);
        // Bold marks the default verb, which is the Windows convention for the action a
        // double-click performs, and double-clicking the tray icon does open the UI.
        _open.FontWeight = FontWeights.SemiBold;
        _open.IsEnabled = false;
        _copyMcp = Item(Strings.Get("tray.copyMcpConfig"), SymbolRegular.BracesVariable24, CopyMcpConfig);
        // Only meaningful when the payload actually bundled the MCP server.
        _copyMcp.Visibility = McpConfig.IsBundled(manifest) ? Visibility.Visible : Visibility.Collapsed;
        _update = Item(Strings.Get("tray.checkForUpdates"), SymbolRegular.ArrowSync24, () => _ = OnUpdateItemClicked());
        _restart = Item(Strings.Get("tray.restartServer"), SymbolRegular.ArrowClockwise24, () => _ = _supervisor.RestartAsync());

        var menu = new ContextMenu { MinWidth = 280 };
        menu.Items.Add(BuildHeader());
        menu.Items.Add(new Separator());
        menu.Items.Add(_open);
        menu.Items.Add(Item(Strings.Get("tray.settings"), SymbolRegular.Settings24, ShowSettings));
        menu.Items.Add(Item(Strings.Get("tray.copyApiToken"), SymbolRegular.Key24, CopyApiToken));
        menu.Items.Add(_copyMcp);
        menu.Items.Add(Item(Strings.Get("tray.openDataFolder"), SymbolRegular.Folder24, () => Shell.OpenFolder(Paths.JobtrackHome)));
        menu.Items.Add(Item(Strings.Get("tray.viewLog"), SymbolRegular.DocumentText24, ShowLog));
        menu.Items.Add(new Separator());
        menu.Items.Add(_update);
        menu.Items.Add(_restart);
        menu.Items.Add(Item(Strings.Get("tray.quit"), SymbolRegular.Power24, () => _ = QuitAsync()));

        _icon = new TaskbarIcon
        {
            Icon = Icons.App,
            ToolTipText = Strings.Get("tray.tooltipStarting"),
            ContextMenu = menu,
            MenuActivation = PopupActivationMode.RightClick,
            NoLeftClickDelay = true,
        };
        // Double-click is what people try first, so it does the obvious thing.
        _icon.TrayMouseDoubleClick += (_, _) => OpenUi();
        _icon.TrayBalloonTipClicked += (_, _) => OnBalloonClicked();
        // Not in any visual tree, so it has to be told to exist. Efficiency mode would lower this
        // process's priority, and this process supervises the server.
        _icon.ForceCreate(enablesEfficiencyMode: false);
        UpdateHeader(ServerState.Starting);

        // WPF tells elements about new theme resources by walking each window's tree, and this menu
        // is in no window, so it would keep the colors it was first shown with. Giving it a new
        // resource dictionary is what makes it look its theme brushes up again.
        ApplicationThemeManager.Changed += (_, _) => Post(() => menu.Resources = new ResourceDictionary());

        _instance.ShowRequested += () => Post(OpenUi);
        _instance.QuitRequested += () => Post(() => _ = QuitAsync());
        _instance.BeginListening();

        _reminders = new ReminderPoller(ReadApiToken, hostLog);
        _reminders.RemindersDue += due => Post(() => ShowReminders(due));

        // Always on, unlike reminders: a backup that silently stopped working is the one thing
        // nobody finds out about until they need it.
        _backups = new BackupClient(ReadApiToken, hostLog);
        _backups.BackupFailed += failure => Post(() => ShowBackupFailed(failure));

        _updates = new UpdateService(_settings, hostLog);
        _updates.StatusChanged += status => Post(() => OnUpdateStatusChanged(status));
        _updates.ApplySchedule();

        _supervisor.StateChanged += state => Post(() => OnStateChanged(state));
        _supervisor.Start();

        ShowStartupNotification(ConnectClaudeDesktop());
    }

    // ------------------------------------------------------------------------------------- menu

    private static MenuItem Item(string text, SymbolRegular symbol, Action onClick)
    {
        var item = new MenuItem { Header = text, Icon = new SymbolIcon { Symbol = symbol, FontSize = 16 } };
        item.Click += (_, _) => onClick();
        return item;
    }

    /// <summary>The app, its version and what the server is doing, above the commands.</summary>
    private MenuItem BuildHeader()
    {
        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(_headerTitle);
        var status = new StackPanel { Orientation = Orientation.Horizontal };
        _statusDot.VerticalAlignment = VerticalAlignment.Center;
        status.Children.Add(_statusDot);
        status.Children.Add(_headerStatus);
        text.Children.Add(status);
        _headerStatus.SetResourceReference(TextBlock.ForegroundProperty, "TextFillColorSecondaryBrush");

        var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 4) };
        row.Children.Add(new System.Windows.Controls.Image { Source = Icons.AppImage, Width = 32, Height = 32, Margin = new Thickness(0, 0, 12, 0) });
        row.Children.Add(text);

        // Hit-test-invisible rather than disabled, so it keeps full-contrast text.
        return new MenuItem { Header = row, IsHitTestVisible = false, Focusable = false };
    }

    private void UpdateHeader(ServerState state)
    {
        var ready = _supervisor.Ready;
        _headerTitle.Text = $"JobTrack {VersionInfo.Host}";
        (_headerStatus.Text, var color) = state switch
        {
            ServerState.Running => (string.Format(Strings.Get("tray.headerRunning"), ready?.Url), Color.FromRgb(0x2E, 0xA0, 0x43)),
            ServerState.Starting => (Strings.Get("tray.headerStarting"), Color.FromRgb(0xE0, 0x9B, 0x1B)),
            ServerState.Restarting => (Strings.Get("tray.headerRestarting"), Color.FromRgb(0xE0, 0x9B, 0x1B)),
            ServerState.Failed => (Strings.Get("tray.headerFailed"), Color.FromRgb(0xD1, 0x34, 0x38)),
            _ => (Strings.Get("tray.headerStopped"), Color.FromRgb(0x8A, 0x8A, 0x8A)),
        };
        _statusDot.Fill = new SolidColorBrush(color);
    }

    // ------------------------------------------------------------------------------------ state

    /// <summary>Runs an action on the UI thread, from wherever it was called.</summary>
    private void Post(Action action)
    {
        if (_dispatcher.HasShutdownStarted) return;
        if (_dispatcher.CheckAccess()) action();
        else _dispatcher.BeginInvoke(action);
    }

    private void OnStateChanged(ServerState state)
    {
        var ready = _supervisor.Ready;
        _open.IsEnabled = state == ServerState.Running;
        _restart.IsEnabled = state != ServerState.Stopped;
        UpdateHeader(state);

        _icon.ToolTipText = state switch
        {
            ServerState.Starting => Strings.Get("tray.tooltipStarting"),
            ServerState.Restarting => Strings.Get("tray.tooltipRestarting"),
            // Tray tooltips are capped at 127 characters, which the URL comfortably fits inside.
            ServerState.Running => string.Format(Strings.Get("tray.tooltipRunning"), ready?.Version, ready?.Url),
            ServerState.Failed => Strings.Get("tray.tooltipFailed"),
            _ => Strings.Get("tray.tooltipStopped"),
        };
        if (ready is not null) _headerTitle.Text = $"JobTrack {ready.Version} ({ready.Driver})";

        if (state == ServerState.Running && ready is not null && _settings.RemindersEnabled) _reminders.Start(ready.Port);
        else if (state != ServerState.Running) _reminders.Stop();

        if (state == ServerState.Running && ready is not null) _backups.Start(ready.Port);
        else if (state != ServerState.Running) _backups.Stop();

        if (state == ServerState.Running && ready is not null)
        {
            // The server just came up (or came back up after a restart), and would otherwise be
            // holding whatever language it last saw, which is stale if this app's language changed
            // while it was down or before it was ever contacted.
            _languageSync.SetPort(ready.Port);
            _ = _languageSync.PushAsync(TranslationSource.Instance.Culture.TwoLetterISOLanguageName);
        }

        switch (state)
        {
            case ServerState.Running when _settings.OpenBrowserOnStart && _launch.ByPerson:
                OpenUi();
                break;

            case ServerState.Failed when _supervisor.LastError is { Code: "EADDRINUSE" } portError:
                // The overwhelmingly likely cause is a second JobTrack, very often an
                // npm-installed one. Restart-looping into a taken port helps nobody; offering the
                // two things a person might actually want to do does.
                Notify(Strings.Get("tray.alreadyRunningTitle"),
                    string.Format(Strings.Get("tray.alreadyRunningMessage"), portError.Port),
                    NotificationIcon.Warning, BalloonAction.OpenExistingServer);
                break;

            case ServerState.Failed:
                Notify(Strings.Get("tray.couldNotStartTitle"), Strings.Get("tray.couldNotStartMessage"), NotificationIcon.Error, BalloonAction.ShowLog);
                break;
        }
    }

    // ---------------------------------------------------------------------------- notifications

    private enum BalloonAction { None, ShowLog, OpenExistingServer, OpenDashboard, InstallUpdate, OpenBackupSettings }

    private BalloonAction _balloonAction = BalloonAction.None;

    private void Notify(string title, string message, NotificationIcon icon, BalloonAction action)
    {
        _balloonAction = action;
        _icon.ShowNotification(title, message, icon);
    }

    private void OnBalloonClicked()
    {
        switch (_balloonAction)
        {
            case BalloonAction.ShowLog:
                ShowLog();
                break;
            case BalloonAction.OpenDashboard:
                if (_supervisor.Ready?.Url is { } url) Shell.OpenUrl($"{url.TrimEnd('/')}/dashboard");
                break;
            case BalloonAction.OpenExistingServer:
                // Whatever holds the port, this is the address it is on.
                var port = _supervisor.LastError?.Port ?? 3001;
                Shell.OpenUrl($"http://127.0.0.1:{port}");
                break;
            case BalloonAction.InstallUpdate:
                _ = InstallUpdateAsync();
                break;
            case BalloonAction.OpenBackupSettings:
                ShowSettings();
                _settingsWindow?.ShowPage(typeof(BackupPage));
                break;
        }
        _balloonAction = BalloonAction.None;
    }

    /// <param name="claudeDesktopNote">A restart hint from <see cref="ConnectClaudeDesktop"/>, if any.</param>
    private void ShowStartupNotification(string? claudeDesktopNote)
    {
        var suffix = claudeDesktopNote is null ? string.Empty : " " + claudeDesktopNote;

        if (!_settings.FirstRunShown)
        {
            _settings.FirstRunShown = true;
            _settings.Save();
            // Windows 11 hides new notification-area icons by default, so without this the app looks
            // like it did nothing at all. One notification replaces another, so the Claude Desktop
            // hint rides along rather than being shown and immediately covered.
            Notify(Strings.Get("tray.firstRunTitle"), string.Format(Strings.Get("tray.firstRunMessage"), suffix),
                NotificationIcon.Info, BalloonAction.None);
        }
        else if (_launch.AfterUpdate)
        {
            // An upgrade usually brings a new MCP server as well, so the two messages arrive together.
            Notify(Strings.Get("tray.updatedTitle"), string.Format(Strings.Get("tray.updatedMessage"), VersionInfo.Host, suffix), NotificationIcon.Info, BalloonAction.None);
        }
        else if (claudeDesktopNote is not null)
        {
            Notify(Strings.Get("tray.restartClaudeTitle"), claudeDesktopNote, NotificationIcon.Info, BalloonAction.None);
        }
    }

    /// <summary>
    /// Points Claude Desktop at the bundled MCP server, and says when Claude Desktop needs a
    /// restart to notice: after the entry changed, or after an upgrade brought a new server.
    /// </summary>
    /// <returns>A sentence for a notification, or null when there is nothing to tell.</returns>
    private string? ConnectClaudeDesktop()
    {
        if (!_settings.ConnectClaudeDesktop || !McpConfig.IsBundled(_manifest)) return null;

        var result = ClaudeDesktop.Register(_manifest);
        foreach (var problem in result.Problems) _hostLog.Write($"Claude Desktop: {problem}");
        // Not installed, or every config it has was left alone.
        if (result.ConfigsFound == 0 || result.Problems.Count >= result.ConfigsFound) return null;
        if (result.Changed > 0) _hostLog.Write($"Claude Desktop now runs the bundled MCP server {_manifest.McpVersion}");

        if (result.Changed == 0 && _settings.ClaudeDesktopMcpVersion == _manifest.McpVersion) return null;
        _settings.ClaudeDesktopMcpVersion = _manifest.McpVersion;
        _settings.Save();
        return string.Format(Strings.Get("tray.claudeConnectedMessage"), _manifest.McpVersion);
    }

    private void OnClaudeDesktopChanged(bool connect)
    {
        if (connect)
        {
            if (ConnectClaudeDesktop() is { } note) Notify(Strings.Get("tray.restartClaudeTitle"), note, NotificationIcon.Info, BalloonAction.None);
            return;
        }

        var result = ClaudeDesktop.Unregister();
        foreach (var problem in result.Problems) _hostLog.Write($"Claude Desktop: {problem}");
        _settings.ClaudeDesktopMcpVersion = null;
        _settings.Save();
        if (result.Changed > 0)
        {
            _hostLog.Write("removed the bundled MCP server from Claude Desktop");
            Notify(Strings.Get("tray.restartClaudeTitle"), Strings.Get("tray.claudeRemovedMessage"),
                NotificationIcon.Info, BalloonAction.None);
        }
    }

    private void ShowReminders(DueReminders due)
    {
        if (!_settings.RemindersEnabled || _quitting) return;
        var (title, message) = due.Describe();
        Notify(title, message, NotificationIcon.Info, BalloonAction.OpenDashboard);
    }

    private void ShowBackupFailed(BackupFailure failure)
    {
        if (_quitting) return;
        Notify(Strings.Get("tray.backupFailedTitle"), failure.Error, NotificationIcon.Warning, BalloonAction.OpenBackupSettings);
    }

    private void OnRemindersChanged(bool enabled)
    {
        if (!enabled) _reminders.Stop();
        else if (_supervisor.State == ServerState.Running && _supervisor.Ready is { } ready) _reminders.Start(ready.Port);
    }

    // ---------------------------------------------------------------------------------- updates

    private void OnUpdateStatusChanged(UpdateStatus status)
    {
        var (text, symbol, enabled, accent) = status switch
        {
            UpdateStatus.Checking => (Strings.Get("tray.checkingForUpdates"), SymbolRegular.ArrowSync24, false, false),
            UpdateStatus.Available available => (string.Format(Strings.Get("tray.installUpdate"), available.Release.Version.ToString(3)), SymbolRegular.ArrowDownload24, true, true),
            UpdateStatus.Downloading downloading => (string.Format(Strings.Get("tray.downloadingUpdate"), downloading.Progress.ToString("P0")), SymbolRegular.ArrowDownload24, false, true),
            UpdateStatus.Installing => (Strings.Get("tray.installingUpdate"), SymbolRegular.ArrowDownload24, false, true),
            UpdateStatus.Failed { Release: not null } failed => (string.Format(Strings.Get("tray.retryUpdate"), failed.Release.Version.ToString(3)), SymbolRegular.ArrowDownload24, true, true),
            _ => (Strings.Get("tray.checkForUpdates"), SymbolRegular.ArrowSync24, true, false),
        };
        _update.Header = text;
        _update.IsEnabled = enabled;
        _update.Icon = new SymbolIcon { Symbol = symbol, FontSize = 16 };
        if (accent) _update.SetResourceReference(Control.ForegroundProperty, "AccentTextFillColorPrimaryBrush");
        else _update.ClearValue(Control.ForegroundProperty);

        var manual = _checkRequestedFromMenu;
        switch (status)
        {
            case UpdateStatus.Available available when manual || _announcedUpdate != available.Release.Version:
                _checkRequestedFromMenu = false;
                _announcedUpdate = available.Release.Version;
                Notify(string.Format(Strings.Get("tray.updateAvailableTitle"), available.Release.Version.ToString(3)),
                    Strings.Get("tray.updateAvailableMessage"),
                    NotificationIcon.Info, BalloonAction.InstallUpdate);
                break;
            case UpdateStatus.UpToDate when manual:
                _checkRequestedFromMenu = false;
                Notify(Strings.Get("tray.upToDateTitle"), string.Format(Strings.Get("tray.upToDateMessage"), VersionInfo.Host), NotificationIcon.Info, BalloonAction.None);
                break;
            case UpdateStatus.Failed failed when manual || failed.Release is not null:
                _checkRequestedFromMenu = false;
                Notify(Strings.Get("tray.updateFailedTitle"), failed.Message, NotificationIcon.Warning, BalloonAction.ShowLog);
                break;
        }
    }

    private async Task OnUpdateItemClicked()
    {
        switch (_updates.Status)
        {
            case UpdateStatus.Available or UpdateStatus.Failed { Release: not null }:
                await InstallUpdateAsync();
                break;
            default:
                _checkRequestedFromMenu = true;
                await _updates.CheckAsync();
                break;
        }
    }

    /// <summary>Downloads, verifies and runs the offered update, then gets out of the installer's way.</summary>
    private async Task InstallUpdateAsync()
    {
        var release = _updates.Status switch
        {
            UpdateStatus.Available available => available.Release,
            UpdateStatus.Failed { Release: { } failed } => failed,
            _ => null,
        };
        if (release is null || _quitting) return;

        var installer = await _updates.DownloadAsync(release);
        if (installer is null || !_updates.Install(release, installer)) return;

        // The installer would stop this process anyway, but quitting now shuts the server down
        // cleanly instead of waiting to be told.
        await QuitAsync();
    }

    // ---------------------------------------------------------------------------------- actions

    private string? ReadApiToken()
    {
        var env = EnvFile.Load(Paths.EnvFile, _manifest.EnvExample is { } example ? Paths.Resolve(example) : null);
        return ApiToken.Read(env);
    }

    private void OpenUi()
    {
        var url = _supervisor.Ready?.Url;
        if (url is null)
        {
            Notify(Strings.Get("tray.stillStartingTitle"), Strings.Get("tray.stillStartingMessage"),
                NotificationIcon.Info, BalloonAction.None);
            return;
        }
        Shell.OpenUrl(url);
    }

    private void ShowSettings()
    {
        if (_settingsWindow is null)
        {
            _settingsWindow = new SettingsWindow(_supervisor, _manifest, _settings, _updates, _backups, InstallUpdateAsync, ShowLog);
            _settingsWindow.RemindersChanged += enabled => Post(() => OnRemindersChanged(enabled));
            _settingsWindow.ClaudeDesktopChanged += connect => Post(() => OnClaudeDesktopChanged(connect));
            _settingsWindow.UpdateScheduleChanged += () => Post(_updates.ApplySchedule);
            _settingsWindow.LanguageChanged += code => _ = _languageSync.PushAsync(code);
            _settingsWindow.Closed += (_, _) => _settingsWindow = null;
            _settingsWindow.Show();
        }
        BringToFront(_settingsWindow);
    }

    private void ShowLog()
    {
        if (_logWindow is null)
        {
            _logWindow = new LogWindow(_hostLog, _serverLog);
            _logWindow.Closed += (_, _) => _logWindow = null;
            _logWindow.Show();
        }
        BringToFront(_logWindow);
    }

    /// <summary>
    /// Windows only lets a process take the foreground when it was the last one given input. A
    /// click in the tray counts, but the menu has closed by now, so it is asked for explicitly.
    /// </summary>
    private static void BringToFront(Window window)
    {
        if (window.WindowState == WindowState.Minimized) window.WindowState = WindowState.Normal;
        window.Activate();
        window.Topmost = true;
        window.Topmost = false;
        window.Focus();
    }

    private void CopyApiToken()
    {
        var token = ReadApiToken();
        if (token is null)
        {
            Notify(Strings.Get("tray.noTokenTitle"), Strings.Get("tray.noTokenMessage"), NotificationIcon.Info, BalloonAction.None);
            return;
        }
        if (Shell.TrySetClipboard(token))
        {
            Notify(Strings.Get("tray.tokenCopiedTitle"), Strings.Get("tray.tokenCopiedMessage"),
                NotificationIcon.Info, BalloonAction.None);
        }
    }

    private void CopyMcpConfig()
    {
        if (Shell.TrySetClipboard(McpConfig.Build(_manifest)))
        {
            Notify(Strings.Get("tray.mcpConfigCopiedTitle"), Strings.Get("tray.mcpConfigCopiedMessage"),
                NotificationIcon.Info, BalloonAction.None);
        }
    }

    private async Task QuitAsync()
    {
        if (_quitting) return;
        _quitting = true;
        _hostLog.Write("quitting");
        _icon.ToolTipText = Strings.Get("tray.tooltipStopping");
        _reminders.Stop();
        _settingsWindow?.Close();
        _logWindow?.Close();
        await _supervisor.StopAsync();
        _icon.Visibility = Visibility.Collapsed;
        Application.Current.Shutdown();
    }

    public void Dispose()
    {
        _icon.Dispose();
        _reminders.Dispose();
        _backups.Dispose();
        _updates.Dispose();
        _languageSync.Dispose();
    }
}
