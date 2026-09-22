using System.Reflection;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using JobTrack.Host.Resources;

namespace JobTrack.Host.UI;

/// <summary>Opening things in whatever the user has configured to open them.</summary>
internal static class Shell
{
    /// <summary>
    /// Opens a URL in the default browser.
    /// </summary>
    /// <remarks>
    /// <c>UseShellExecute = true</c> is what makes the shell resolve the default handler; it is
    /// also, incidentally, the one place in this application where a shell execute is correct.
    /// The npm tray shells out to <c>cmd /c start</c> for the same job, which flashes a console.
    /// </remarks>
    public static void OpenUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception error) when (error is Win32Exception or FileNotFoundException)
        {
            MessageBox.Show(string.Format(Strings.Get("shell.couldNotOpen"), url, error.Message), Strings.Get("shell.errorTitle"),
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    public static void OpenFolder(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }

    public static void OpenInEditor(string path)
    {
        if (!File.Exists(path)) return;
        Process.Start(new ProcessStartInfo("notepad.exe", $"\"{path}\"") { UseShellExecute = false, CreateNoWindow = true });
    }

    /// <summary>
    /// Puts text on the clipboard, retrying briefly.
    /// </summary>
    /// <remarks>
    /// The Windows clipboard is a shared, lockable resource: another application holding it open
    /// makes the first attempt throw. A couple of retries turns a visible failure into a
    /// non-event.
    /// </remarks>
    public static bool TrySetClipboard(string text)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                Clipboard.SetText(text);
                return true;
            }
            catch (ExternalException)
            {
                Thread.Sleep(80);
            }
        }
        return false;
    }
}

/// <summary>The application icon, loaded once from the embedded copy of the web UI's favicon.</summary>
internal static class Icons
{
    private static readonly Lazy<System.Drawing.Icon> Loaded = new(() =>
    {
        using var stream = OpenIcon();
        return stream is null ? System.Drawing.SystemIcons.Application : new System.Drawing.Icon(stream);
    });

    private static readonly Lazy<ImageSource?> Image = new(() =>
    {
        using var stream = OpenIcon();
        if (stream is null) return null;
        var decoder = new IconBitmapDecoder(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
        // The largest frame, so a title bar at 150% scaling is scaled down rather than up.
        var frame = decoder.Frames.MaxBy(candidate => candidate.PixelWidth);
        frame?.Freeze();
        return frame;
    });

    /// <summary>For the tray, which needs a real icon handle.</summary>
    public static System.Drawing.Icon App => Loaded.Value;

    /// <summary>For window title bars and the tray menu's header.</summary>
    public static ImageSource? AppImage => Image.Value;

    private static Stream? OpenIcon() => Assembly.GetExecutingAssembly().GetManifestResourceStream("JobTrack.ico");
}
