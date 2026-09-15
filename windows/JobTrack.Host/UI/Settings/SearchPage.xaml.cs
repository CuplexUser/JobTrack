using System.Windows;
using System.Windows.Controls;

namespace JobTrack.Host.UI.Settings;

internal partial class SearchPage : Page
{
    private readonly SettingsModel _model;

    public SearchPage(SettingsModel model)
    {
        _model = model;
        DataContext = model;
        InitializeComponent();
    }

    private void OnOpenCache(object sender, RoutedEventArgs e) => Shell.OpenFolder(_model.ResolvedModelCacheDir());
}
