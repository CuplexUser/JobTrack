using System.Windows.Data;
using System.Windows.Markup;

namespace JobTrack.Host.Localization;

/// <summary>
/// <c>{loc:Loc SomeKey}</c> in XAML: a one-way binding to <see cref="TranslationSource"/>'s
/// indexer, so the bound property updates the moment the language changes, without recreating
/// the element.
/// </summary>
/// <remarks>
/// This only works against a real <c>DependencyProperty</c> — a plain CLR property (as
/// <see cref="UI.Settings.SettingHeader"/>'s <c>Title</c>/<c>Description</c> used to be) cannot be
/// the target of a live <c>Binding</c> at all, which is why those became dependency properties.
/// </remarks>
[MarkupExtensionReturnType(typeof(string))]
internal sealed class LocExtension(string key) : MarkupExtension
{
    /// <summary>The resx key, taken positionally: <c>{loc:Loc SomeKey}</c>.</summary>
    public string Key { get; set; } = key;

    public override object ProvideValue(IServiceProvider serviceProvider) =>
        new Binding($"[{Key}]") { Source = TranslationSource.Instance, Mode = BindingMode.OneWay }
            .ProvideValue(serviceProvider);
}
