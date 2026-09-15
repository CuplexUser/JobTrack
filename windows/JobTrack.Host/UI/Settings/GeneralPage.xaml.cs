using System.Windows.Controls;

namespace JobTrack.Host.UI.Settings;

internal partial class GeneralPage : Page
{
    public GeneralPage(SettingsModel model)
    {
        DataContext = model;
        InitializeComponent();
    }
}
