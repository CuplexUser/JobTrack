using JobTrack.Host.Config;
using JobTrack.Host.Hosting;
using JobTrack.Host.Localization;
using JobTrack.Host.Resources;
using JobTrack.Host.UI;
using JobTrack.Host.Updates;

namespace JobTrack.Host;

internal static class Program
{
    /// <summary>
    /// Passed by the installer's Run-key entry, and by the uninstaller.
    /// </summary>
    private const string QuitSwitch = "--quit";

    /// <summary>
    /// Passed by the uninstaller, so Claude Desktop is not left starting a server that no longer
    /// exists.
    /// </summary>
    private const string DisconnectClaudeDesktopSwitch = "--disconnect-claude-desktop";

    [STAThread]
    private static int Main(string[] args)
    {
        // The uninstaller and an in-place upgrade both need a running copy gone before they can
        // touch the files it has open. This is that door: signal, wait, report.
        if (args.Contains(QuitSwitch, StringComparer.OrdinalIgnoreCase))
        {
            return SingleInstance.SignalQuitAndWait(TimeSpan.FromSeconds(15)) ? 0 : 1;
        }

        if (args.Contains(DisconnectClaudeDesktopSwitch, StringComparer.OrdinalIgnoreCase))
        {
            return ClaudeDesktop.Unregister().Problems.Count == 0 ? 0 : 1;
        }

        // A second launch — someone clicked the Start Menu shortcut while it was already running —
        // opens the UI rather than starting a second server that would collide on the port.
        var instance = SingleInstance.TryAcquire();
        if (instance is null)
        {
            SingleInstance.SignalShow();
            return 0;
        }

        Paths.EnsureDataDirectories();

        var hostSettings = HostSettings.Load();
        // Before any window is built: TranslationSource's setter also sets CultureInfo.CurrentUICulture
        // and Strings.Culture, so every {loc:Loc} binding and every Strings.Get call from here on
        // resolves in the right language, including the two error dialogs below.
        TranslationSource.Instance.Culture = SupportedLanguages.Resolve(hostSettings.Language);

        using var hostLog = new RollingLog("host.log");
        using var serverLog = new RollingLog("server.log");
        var launchedAtSignIn = args.Contains(Autostart.AutostartSwitch, StringComparer.OrdinalIgnoreCase);
        var justUpdated = args.Contains(UpdateInstaller.UpdatedSwitch, StringComparer.OrdinalIgnoreCase);
        hostLog.Write($"JobTrack host {VersionInfo.Host} starting{(launchedAtSignIn ? " (sign-in)" : justUpdated ? " (after an update)" : string.Empty)}");

        LaunchManifest manifest;
        try
        {
            manifest = LaunchManifest.Load();
        }
        catch (Exception error) when (error is IOException or InvalidDataException)
        {
            // Nothing can work without the payload, and there is no console to print to.
            hostLog.Write($"could not load the launch manifest: {error.Message}");
            System.Windows.MessageBox.Show(
                string.Format(Strings.Get("program.missingInstallMessage"), error.Message),
                Strings.Get("program.missingInstallTitle"), System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Error);
            instance.Dispose();
            return 2;
        }

        var app = new App();
        app.InitializeComponent();
        // A fault in a window should cost that window, not the server this process supervises:
        // the job object takes node.exe down with the host, so a crash here would be an outage.
        app.DispatcherUnhandledException += (_, e) =>
        {
            hostLog.Write($"unhandled UI exception: {e.Exception}");
            System.Windows.MessageBox.Show(string.Format(Strings.Get("program.uiErrorMessage"), e.Exception.Message),
                Strings.Get("program.uiErrorTitle"), System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
            e.Handled = true;
        };

        using var supervisor = new NodeSupervisor(manifest, hostLog, serverLog);
        // Constructed once the theme resources exist, on the thread that will run the dispatcher.
        TrayController? tray = null;
        app.Startup += (_, _) => tray = new TrayController(supervisor, manifest, instance, hostSettings, hostLog, serverLog,
            new LaunchReason(launchedAtSignIn, justUpdated));

        app.Run();
        tray?.Dispose();
        instance.Dispose();
        hostLog.Write("host stopped");
        return 0;
    }
}

/// <summary>Why this process was started, which decides what it says and opens on the way up.</summary>
/// <param name="AtSignIn">Started from the Run key, so nobody is waiting for a browser window.</param>
/// <param name="AfterUpdate">Relaunched by the installer at the end of an in-app update.</param>
internal readonly record struct LaunchReason(bool AtSignIn, bool AfterUpdate)
{
    /// <summary>Whether someone deliberately started JobTrack just now, and might want the UI opened.</summary>
    public bool ByPerson => !AtSignIn && !AfterUpdate;
}
