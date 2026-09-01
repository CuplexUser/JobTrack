using JobTrack.Host.Config;
using JobTrack.Host.Hosting;
using JobTrack.Host.UI;

namespace JobTrack.Host;

internal static class Program
{
    /// <summary>
    /// Passed by the installer's Run-key entry, and by the uninstaller.
    /// </summary>
    private const string QuitSwitch = "--quit";

    [STAThread]
    private static int Main(string[] args)
    {
        // The uninstaller and an in-place upgrade both need a running copy gone before they can
        // touch the files it has open. This is that door: signal, wait, report.
        if (args.Contains(QuitSwitch, StringComparer.OrdinalIgnoreCase))
        {
            return SingleInstance.SignalQuitAndWait(TimeSpan.FromSeconds(15)) ? 0 : 1;
        }

        // A second launch — someone clicked the Start Menu shortcut while it was already running —
        // opens the UI rather than starting a second server that would collide on the port.
        var instance = SingleInstance.TryAcquire();
        if (instance is null)
        {
            SingleInstance.SignalShow();
            return 0;
        }

        ApplicationConfiguration.Initialize();
        Paths.EnsureDataDirectories();

        using var hostLog = new RollingLog("host.log");
        using var serverLog = new RollingLog("server.log");
        var launchedAtSignIn = args.Contains(Autostart.AutostartSwitch, StringComparer.OrdinalIgnoreCase);
        hostLog.Write($"JobTrack host {VersionInfo.Host} starting{(launchedAtSignIn ? " (sign-in)" : string.Empty)}");

        LaunchManifest manifest;
        try
        {
            manifest = LaunchManifest.Load();
        }
        catch (Exception error) when (error is IOException or InvalidDataException)
        {
            // Nothing can work without the payload, and there is no console to print to.
            hostLog.Write($"could not load the launch manifest: {error.Message}");
            MessageBox.Show(
                $"JobTrack could not start because part of its installation is missing.\n\n{error.Message}",
                "JobTrack", MessageBoxButtons.OK, MessageBoxIcon.Error);
            instance.Dispose();
            return 2;
        }

        using var supervisor = new NodeSupervisor(manifest, hostLog, serverLog);
        using var tray = new TrayApplicationContext(supervisor, manifest, instance, hostLog, serverLog, launchedAtSignIn);

        Application.Run(tray);
        instance.Dispose();
        hostLog.Write("host stopped");
        return 0;
    }
}
