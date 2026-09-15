namespace JobTrack.Host.UI.Settings;

/// <summary>What a settings page may ask of the window it sits in.</summary>
internal interface ISettingsHost
{
    Task ShowMessageAsync(string title, string message);

    /// <returns>True when the person chose <paramref name="confirmText"/>; Cancel is the default.</returns>
    Task<bool> ConfirmAsync(string title, string message, string confirmText);

    /// <summary>A brief, self-dismissing confirmation that something worked.</summary>
    void ShowToast(string title, string message);
}
