using System.Globalization;

namespace JobTrack.Host.Localization;

/// <summary>
/// The live source every <c>{loc:Loc}</c> binding in XAML reads from.
/// </summary>
/// <remarks>
/// <see cref="Resources.Strings"/> gives static, compile-time access to whichever culture is
/// currently set, but a plain static lookup only ever reflects what the culture was when the
/// element was first drawn — a XAML <c>Binding</c> only refreshes when the thing it is bound to
/// raises <see cref="PropertyChanged"/>. So this holds the culture instead, and firing that event
/// for every key at once when it changes is what makes an already-open window's text flip
/// language without being recreated.
/// </remarks>
internal sealed class TranslationSource : INotifyPropertyChanged
{
    public static TranslationSource Instance { get; } = new();

    private CultureInfo _culture = CultureInfo.CurrentUICulture;

    public event PropertyChangedEventHandler? PropertyChanged;

    public CultureInfo Culture
    {
        get => _culture;
        set
        {
            if (Equals(_culture, value)) return;
            _culture = value;
            CultureInfo.CurrentUICulture = value;
            Resources.Strings.Culture = value;
            // WPF treats an indexer as one property named "Item[]" (the same convention
            // ObservableCollection<T> uses); raising it for that name refreshes every
            // `{loc:Loc}` binding at once, in every open window, wherever it is bound.
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Item[]"));
        }
    }

    /// <summary>What a <c>{loc:Loc Key}</c> binding's path resolves through.</summary>
    public string this[string key] => Resources.Strings.Get(key);
}
