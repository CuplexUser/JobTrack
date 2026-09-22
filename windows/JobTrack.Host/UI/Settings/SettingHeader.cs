using System.Windows;
using System.Windows.Controls;

namespace JobTrack.Host.UI.Settings;

/// <summary>
/// A setting card's title with its line of explanation underneath, as PowerToys lays them out.
/// </summary>
/// <remarks>
/// Nearly every card on every page has exactly this header, and spelling out the two styled text
/// blocks each time would bury the settings themselves in markup.
///
/// <see cref="Title"/> and <see cref="Description"/> are real dependency properties, not plain
/// CLR ones, specifically so a <c>{loc:Loc}</c> binding (<see cref="Localization.LocExtension"/>)
/// can target them and pick up a language change live; a plain CLR property cannot be the target
/// of a live <c>Binding</c> at all.
/// </remarks>
internal sealed class SettingHeader : StackPanel
{
    private readonly TextBlock _title = new();
    private readonly TextBlock _description = new() { Visibility = Visibility.Collapsed };

    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(SettingHeader), new PropertyMetadata(string.Empty, OnTitleChanged));

    public static readonly DependencyProperty DescriptionProperty = DependencyProperty.Register(
        nameof(Description), typeof(string), typeof(SettingHeader), new PropertyMetadata(string.Empty, OnDescriptionChanged));

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
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    public string Description
    {
        get => (string)GetValue(DescriptionProperty);
        set => SetValue(DescriptionProperty, value);
    }

    private static void OnTitleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((SettingHeader)d)._title.Text = (string)e.NewValue;

    private static void OnDescriptionChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var header = (SettingHeader)d;
        var value = (string)e.NewValue;
        header._description.Text = value;
        header._description.Visibility = string.IsNullOrEmpty(value) ? Visibility.Collapsed : Visibility.Visible;
    }
}
