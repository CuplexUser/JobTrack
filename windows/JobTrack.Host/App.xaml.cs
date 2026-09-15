using System.Windows;
using Microsoft.Win32;
using Wpf.Ui.Appearance;

namespace JobTrack.Host;

/// <summary>
/// The WPF application: the Fluent theme resources, and keeping them in step with Windows.
/// </summary>
/// <remarks>
/// Every window watches the system theme for itself (see <see cref="UI.WindowTheme"/>), but the
/// tray menu is not a window anyone watches, and it is the one surface that is on screen at
/// every theme change. So the application follows the system setting too, and the menu, which
/// only uses dynamic theme brushes, follows it.
/// </remarks>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        ApplySystemTheme();
        SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
    }

    protected override void OnExit(ExitEventArgs e)
    {
        SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
        base.OnExit(e);
    }

    /// <summary>
    /// Light/dark and the accent color are both reported as a General preference change, which
    /// arrives on the SystemEvents thread rather than this one.
    /// </summary>
    private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (e.Category is UserPreferenceCategory.General or UserPreferenceCategory.Color)
        {
            Dispatcher.BeginInvoke(ApplySystemTheme);
        }
    }

    private static void ApplySystemTheme()
    {
        SystemThemeManager.UpdateSystemThemeCache();
        ApplicationThemeManager.ApplySystemTheme(updateAccent: true);
    }
}
