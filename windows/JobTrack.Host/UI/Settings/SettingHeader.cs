using System.Windows;
using System.Windows.Controls;

namespace JobTrack.Host.UI.Settings;

/// <summary>
/// A setting card's title with its line of explanation underneath, as PowerToys lays them out.
/// </summary>
/// <remarks>
/// Nearly every card on every page has exactly this header, and spelling out the two styled text
/// blocks each time would bury the settings themselves in markup.
/// </remarks>
internal sealed class SettingHeader : StackPanel
{
    private readonly TextBlock _title = new();
    private readonly TextBlock _description = new() { Visibility = Visibility.Collapsed };

    public SettingHeader()
    {
        VerticalAlignment = VerticalAlignment.Center;
        Margin = new Thickness(0, 0, 16, 0);
        _title.SetResourceReference(StyleProperty, "CardTitle");
        _description.SetResourceReference(StyleProperty, "CardDescription");
        Children.Add(_title);
        Children.Add(_description);
    }

    public string Title
    {
        get => _title.Text;
        set => _title.Text = value;
    }

    public string Description
    {
        get => _description.Text;
        set
        {
            _description.Text = value;
            _description.Visibility = string.IsNullOrEmpty(value) ? Visibility.Collapsed : Visibility.Visible;
        }
    }
}
