using System.Windows;
using JobTrack.Host.Config;
using JobTrack.Host.Hosting;
using JobTrack.Host.UI.Settings;
using JobTrack.Host.Updates;
using Wpf.Ui.Abstractions;
using Wpf.Ui.Controls;

namespace JobTrack.Host.UI;

/// <summary>
/// The settings window: a navigation pane of pages, in the layout PowerToys uses.
/// </summary>
/// <remarks>
/// Every page edits one shared <see cref="SettingsModel"/>, so moving between pages loses nothing
/// and Save writes everything at once. The pages are built once and handed to the navigation
/// view by <see cref="PageProvider"/>, rather than created fresh on every visit.
/// </remarks>
internal partial class SettingsWindow : FluentWindow, ISettingsHost
{
    private readonly NodeSupervisor _supervisor;
    private readonly SettingsModel _model;

    /// <summary>Raised on save with the reminders setting, so the tray can start or stop polling at once.</summary>
    public event Action<bool>? RemindersChanged;

    /// <summary>Raised on save when the Claude Desktop setting changed, so the tray can apply it at once.</summary>
    public event Action<bool>? ClaudeDesktopChanged;

    /// <summary>Raised when automatic update checks are switched on or off, which applies at once.</summary>
    public event Action? UpdateScheduleChanged;

    public SettingsWindow(
        NodeSupervisor supervisor,
        LaunchManifest manifest,
        HostSettings hostSettings,
        UpdateService updates,
        Func<Task> installUpdate,
        Action showLog)
    {
        _supervisor = supervisor;
        _model = new SettingsModel(manifest, hostSettings);
        InitializeComponent();

        Icon = Icons.AppImage;
        WindowTitleBar.Icon = new ImageIcon { Source = Icons.AppImage, Width = 16, Height = 16 };
        WindowTheme.Follow(this);

        Navigation.SetPageProviderService(new PageProvider(
            new GeneralPage(_model),
            new DatabasePage(_model),
            new SearchPage(_model),
            new AccessPage(_model, this),
            new UpdatesPage(updates, hostSettings, installUpdate, () => UpdateScheduleChanged?.Invoke()),
            new AdvancedPage(_model),
            new AboutPage(manifest, supervisor, showLog)));
        Navigation.Navigating += (_, e) => _model.SetRawEditing(e.Page is AdvancedPage);
        Loaded += (_, _) => Navigation.Navigate(typeof(GeneralPage));
    }

    // ---------------------------------------------------------------------------------- actions

    private void OnCancel(object sender, RoutedEventArgs e) => Close();

    private async void OnSave(object sender, RoutedEventArgs e) => await SaveAsync(restart: false);

    private async void OnSaveAndRestart(object sender, RoutedEventArgs e) => await SaveAsync(restart: true);

    private async Task SaveAsync(bool restart)
    {
        var result = _model.Save();
        if (result.Problem is { } problem)
        {
            await ShowMessageAsync("Settings were not saved", problem);
            return;
        }

        RemindersChanged?.Invoke(result.RemindersEnabled);
        if (result.ClaudeDesktopChanged) ClaudeDesktopChanged?.Invoke(_model.ConnectClaudeDesktop);

        Close();
        if (restart) await _supervisor.RestartAsync();
    }

    // ----------------------------------------------------------------------------- ISettingsHost

    public async Task ShowMessageAsync(string title, string message)
    {
        var dialog = new ContentDialog(DialogHost)
        {
            Title = title,
            Content = new System.Windows.Controls.TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, MaxWidth = 420 },
            CloseButtonText = "OK",
        };
        await dialog.ShowAsync();
    }

    public async Task<bool> ConfirmAsync(string title, string message, string confirmText)
    {
        var dialog = new ContentDialog(DialogHost)
        {
            Title = title,
            Content = new System.Windows.Controls.TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, MaxWidth = 420 },
            PrimaryButtonText = confirmText,
            PrimaryButtonAppearance = ControlAppearance.Danger,
            CloseButtonText = "Cancel",
            // A destructive action should never be one Enter key away.
            DefaultButton = ContentDialogButton.Close,
        };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }

    public void ShowToast(string title, string message)
    {
        var snackbar = new Snackbar(Snackbars)
        {
            Title = title,
            Content = message,
            Appearance = ControlAppearance.Success,
            Icon = new SymbolIcon { Symbol = SymbolRegular.CheckmarkCircle24, FontSize = 20 },
            Timeout = TimeSpan.FromSeconds(3),
        };
        snackbar.Show();
    }

    /// <summary>Hands the navigation view the pages built above, instead of letting it create its own.</summary>
    private sealed class PageProvider(params object[] pages) : INavigationViewPageProvider
    {
        public object? GetPage(Type pageType) => pages.FirstOrDefault(page => page.GetType() == pageType);
    }
}
