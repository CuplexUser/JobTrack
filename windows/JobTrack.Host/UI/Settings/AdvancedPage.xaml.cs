using System.Windows;
using System.Windows.Controls;
using JobTrack.Host.Config;

namespace JobTrack.Host.UI.Settings;

internal partial class AdvancedPage : Page
{
    public AdvancedPage(SettingsModel model)
    {
        DataContext = model;
        InitializeComponent();
    }

    private void OnOpenInNotepad(object sender, RoutedEventArgs e) => Shell.OpenInEditor(Paths.EnvFile);

    private void OnOpenDataFolder(object sender, RoutedEventArgs e) => Shell.OpenFolder(Paths.JobtrackHome);
}
