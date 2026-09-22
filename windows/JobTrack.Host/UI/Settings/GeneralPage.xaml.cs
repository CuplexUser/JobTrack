using System.Windows.Controls;

namespace JobTrack.Host.UI.Settings;

internal partial class GeneralPage : Page
{
    private readonly SettingsModel _model;

    public GeneralPage(SettingsModel model)
    {
        _model = model;
        DataContext = model;
        InitializeComponent();

        foreach (ComboBoxItem item in LanguageChoice.Items)
        {
            if (Equals(item.Tag as string, model.Language)) LanguageChoice.SelectedItem = item;
        }
        LanguageChoice.SelectedItem ??= LanguageChoice.Items[0];
    }

    private void OnLanguageSelected(object sender, SelectionChangedEventArgs e)
    {
        if (LanguageChoice.SelectedItem is ComboBoxItem { Tag: var tag }) _model.Language = tag as string;
    }
}
