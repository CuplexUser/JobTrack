using System.Windows;
using System.Windows.Controls;
using JobTrack.Host.Resources;

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
            _host.ShowToast(Strings.Get("access.tokenCopiedTitle"), Strings.Get("access.tokenCopiedMessage"));
        }
    }

    private async void OnRegenerate(object sender, RoutedEventArgs e)
    {
        if (_model.TokenIsConfigured)
        {
            await _host.ShowMessageAsync(Strings.Get("access.tokenSetInEnvTitle"),
                Strings.Get("access.tokenSetInEnvMessage"));
            return;
        }

        var confirmed = await _host.ConfirmAsync(Strings.Get("access.confirmRegenerateTitle"),
            Strings.Get("access.confirmRegenerateMessage"),
            Strings.Get("access.regenerate"));
        if (confirmed) _model.RegenerateToken();
    }
}
