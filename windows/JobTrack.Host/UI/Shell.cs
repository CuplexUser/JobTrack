using System.Drawing;
using System.Reflection;

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
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or FileNotFoundException)
        {
            MessageBox.Show($"Could not open {url}.\n\n{error.Message}", "JobTrack",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
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
    private static readonly Lazy<Icon> Loaded = new(() =>
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("JobTrack.ico");
        return stream is null ? SystemIcons.Application : new Icon(stream);
    });

    public static Icon App => Loaded.Value;
}
