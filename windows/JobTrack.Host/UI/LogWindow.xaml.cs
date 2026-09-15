using System.Windows;
using JobTrack.Host.Config;
using JobTrack.Host.Hosting;
using Wpf.Ui.Controls;

namespace JobTrack.Host.UI;

/// <summary>
/// A read-only view of the two log files.
/// </summary>
/// <remarks>
/// With no console, the logs are the only account of what happened, and "click here to see the
/// log" is the useful half of an error notification. Opening them in Notepad would work, but a
/// refreshable window that already knows where they are is a better answer to "it isn't working"
/// than asking someone to go and find a directory.
/// </remarks>
internal partial class LogWindow : FluentWindow
{
    private const int TailLines = 500;

    private readonly RollingLog _hostLog;
    private readonly RollingLog _serverLog;

    public LogWindow(RollingLog hostLog, RollingLog serverLog)
    {
        _hostLog = hostLog;
        _serverLog = serverLog;
        InitializeComponent();

        Icon = Icons.AppImage;
        WindowTitleBar.Icon = new ImageIcon { Source = Icons.AppImage, Width = 16, Height = 16 };
        WindowTheme.Follow(this);
        Loaded += (_, _) => ShowTail();
    }

    private void OnLogChosen(object sender, RoutedEventArgs e)
    {
        // Checked fires for the default choice while the XAML is still being loaded.
        if (IsLoaded) ShowTail();
    }

    private void OnRefresh(object sender, RoutedEventArgs e) => ShowTail();

    private void OnCopy(object sender, RoutedEventArgs e) => Shell.TrySetClipboard(LogText.Text);

    private void OnOpenFolder(object sender, RoutedEventArgs e) => Shell.OpenFolder(Paths.LogDir);

    private void ShowTail()
    {
        var log = HostChoice.IsChecked == true ? _hostLog : _serverLog;
        LogText.Text = log.Tail(TailLines);
        LogText.CaretIndex = LogText.Text.Length;
        LogText.ScrollToEnd();
    }
}
