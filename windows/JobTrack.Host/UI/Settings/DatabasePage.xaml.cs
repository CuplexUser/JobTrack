using System.Windows;
using System.Windows.Controls;
using JobTrack.Host.Config;
using JobTrack.Host.Resources;
using Microsoft.Win32;

namespace JobTrack.Host.UI.Settings;

internal partial class DatabasePage : Page
{
    private readonly SettingsModel _model;

    public DatabasePage(SettingsModel model)
    {
        _model = model;
        DataContext = model;
        InitializeComponent();
    }

    private void OnBrowse(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog
        {
            Title = Strings.Get("database.browseDialogTitle"),
            Filter = Strings.Get("database.browseFilter"),
            FileName = "jobtrack.db",
            InitialDirectory = Paths.DataDir,
            OverwritePrompt = false, // Picking an existing database is the normal case, not a mistake.
        };
        if (dialog.ShowDialog(Window.GetWindow(this)) == true) _model.DbFile = dialog.FileName;
    }
}
