using System.Windows;
using System.Windows.Controls;

namespace JobTrack.Host.UI.Settings;

internal partial class AccessPage : Page
{
    private readonly SettingsModel _model;
    private readonly ISettingsHost _host;

    public AccessPage(SettingsModel model, ISettingsHost host)
    {
        _model = model;
        _host = host;
        DataContext = model;
        InitializeComponent();
    }

    private void OnCopy(object sender, RoutedEventArgs e)
    {
        if (_model.Token is { } token && Shell.TrySetClipboard(token))
        {
            _host.ShowToast("API token copied", "Paste it into the JobTrack Clipper extension's options page.");
        }
    }

    private async void OnRegenerate(object sender, RoutedEventArgs e)
    {
        if (_model.TokenIsConfigured)
        {
            await _host.ShowMessageAsync("The token is set in .env",
                "API_TOKEN is set in .env, so JobTrack is using the token you configured. Change it on the Advanced page.");
            return;
        }

        var confirmed = await _host.ConfirmAsync("Generate a new API token?",
            "Any browser extension using the current token will stop working until you paste in the new one.",
            "Regenerate");
        if (confirmed) _model.RegenerateToken();
    }
}
