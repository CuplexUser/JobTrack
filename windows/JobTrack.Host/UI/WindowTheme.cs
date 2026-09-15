using Wpf.Ui.Appearance;
using Wpf.Ui.Controls;

namespace JobTrack.Host.UI;

/// <summary>Keeps a window's theme and backdrop in step with the Windows settings while it is open.</summary>
/// <remarks>
/// Mica needs Windows 11. On Windows 10 WPF-UI leaves the window on the theme's solid background,
/// so the same call serves both without a version check here.
/// </remarks>
internal static class WindowTheme
{
    public static void Follow(FluentWindow window)
    {
        // The watcher hooks the window's message loop, which only exists once it has a handle.
        window.SourceInitialized += (_, _) => SystemThemeWatcher.Watch(window, WindowBackdropType.Mica, updateAccents: true);
        // Closing, not Closed: by Closed the handle is gone and UnWatch throws for want of it.
        window.Closing += (_, _) => SystemThemeWatcher.UnWatch(window);
    }
}
