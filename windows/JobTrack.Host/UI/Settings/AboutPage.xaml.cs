using System.Windows;
using System.Windows.Controls;
using JobTrack.Host.Config;
using JobTrack.Host.Hosting;

namespace JobTrack.Host.UI.Settings;

internal partial class AboutPage : Page
{
    private const string ProjectUrl = "https://github.com/CuplexUser/JobTrack";

    private readonly Action _showLog;

    public AboutPage(LaunchManifest manifest, NodeSupervisor supervisor, Action showLog)
    {
        _showLog = showLog;
        InitializeComponent();

        AppIcon.Source = Icons.AppImage;
        ProductName.Text = $"JobTrack {VersionInfo.Host}";

        AddVersion("JobTrack", manifest.JobtrackVersion);
        AddVersion("API server", manifest.ApiVersion);
        AddVersion("MCP server", manifest.McpVersion);
        AddVersion("Node.js runtime", manifest.NodeVersion);
        AddVersion("Database driver", supervisor.Ready?.Driver);
    }

    private void AddVersion(string name, string? value)
    {
        if (string.IsNullOrEmpty(value)) return;
        var row = Versions.RowDefinitions.Count;
        Versions.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var label = new TextBlock { Text = name, Margin = new Thickness(0, 3, 0, 3) };
        label.SetResourceReference(TextBlock.ForegroundProperty, "TextFillColorSecondaryBrush");
        var text = new TextBlock { Text = value, Margin = new Thickness(0, 3, 0, 3) };
        text.SetResourceReference(TextBlock.FontFamilyProperty, "MonoFont");

        Grid.SetRow(label, row);
        Grid.SetRow(text, row);
        Grid.SetColumn(text, 1);
        Versions.Children.Add(label);
        Versions.Children.Add(text);
    }

    private void OnEmail(object sender, System.Windows.Navigation.RequestNavigateEventArgs e)
    {
        Shell.OpenUrl(e.Uri.AbsoluteUri);
        e.Handled = true;
    }

    private void OnProjectPage(object sender, RoutedEventArgs e) => Shell.OpenUrl(ProjectUrl);

    private void OnReportIssue(object sender, RoutedEventArgs e) => Shell.OpenUrl($"{ProjectUrl}/issues/new");

    private void OnViewLog(object sender, RoutedEventArgs e) => _showLog();

    private void OnDataFolder(object sender, RoutedEventArgs e) => Shell.OpenFolder(Paths.JobtrackHome);
}
