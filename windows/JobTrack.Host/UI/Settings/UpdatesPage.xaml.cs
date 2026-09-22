using System.Windows;
using System.Windows.Controls;
using JobTrack.Host.Config;
using JobTrack.Host.Resources;
using JobTrack.Host.Updates;
using Wpf.Ui.Controls;

namespace JobTrack.Host.UI.Settings;

/// <summary>
/// The current version, what the updater is doing, and the button that moves it along.
/// </summary>
/// <remarks>
/// Driven entirely by <see cref="UpdateService.StatusChanged"/>, so the tray menu and this page
/// always show the same state, whichever of them started a check or a download.
/// </remarks>
internal partial class UpdatesPage : Page
{
    private const string ReleasesUrl = "https://github.com/CuplexUser/JobTrack/releases";

    private readonly UpdateService _updates;
    private readonly HostSettings _settings;
    private readonly Func<Task> _installUpdate;
    private readonly Action _scheduleChanged;

    public UpdatesPage(UpdateService updates, HostSettings settings, Func<Task> installUpdate, Action scheduleChanged)
    {
        _updates = updates;
        _settings = settings;
        _installUpdate = installUpdate;
        _scheduleChanged = scheduleChanged;
        InitializeComponent();

        AppIcon.Source = Icons.AppImage;
        AutoCheck.IsChecked = settings.CheckForUpdates;

        Loaded += (_, _) =>
        {
            _updates.StatusChanged += OnStatusChanged;
            Show(_updates.Status);
        };
        Unloaded += (_, _) => _updates.StatusChanged -= OnStatusChanged;
    }

    private void OnStatusChanged(UpdateStatus status) => Dispatcher.BeginInvoke(() => Show(status));

    private void Show(UpdateStatus status)
    {
        var current = VersionInfo.Host;
        Busy.Visibility = status is UpdateStatus.Checking or UpdateStatus.Installing ? Visibility.Visible : Visibility.Collapsed;
        DownloadProgress.Visibility = status is UpdateStatus.Downloading ? Visibility.Visible : Visibility.Collapsed;
        ActionButton.IsEnabled = status is not (UpdateStatus.Checking or UpdateStatus.Downloading or UpdateStatus.Installing);
        Problem.IsOpen = false;

        switch (status)
        {
            case UpdateStatus.Available available:
                StatusTitle.Text = string.Format(Strings.Get("updates.availableTitle"), available.Release.Version.ToString(3));
                StatusDetail.Text = string.Format(Strings.Get("updates.availableDetail"), current);
                SetAction(Strings.Get("updates.installAction"), SymbolRegular.ArrowDownload24, primary: true);
                break;

            case UpdateStatus.Downloading downloading:
                StatusTitle.Text = string.Format(Strings.Get("updates.downloadingTitle"), downloading.Release.Version.ToString(3));
                StatusDetail.Text = string.Format(Strings.Get("updates.downloadingDetail"), downloading.Progress.ToString("P0"), (downloading.Release.Size / 1_048_576d).ToString("N0"));
                DownloadProgress.Value = downloading.Progress;
                SetAction(Strings.Get("updates.installAction"), SymbolRegular.ArrowDownload24, primary: true);
                break;

            case UpdateStatus.Installing installing:
                StatusTitle.Text = string.Format(Strings.Get("updates.installingTitle"), installing.Release.Version.ToString(3));
                StatusDetail.Text = Strings.Get("updates.installingDetail");
                SetAction(Strings.Get("updates.installAction"), SymbolRegular.ArrowDownload24, primary: true);
                break;

            case UpdateStatus.Checking:
                StatusTitle.Text = string.Format(Strings.Get("updates.checkingTitle"), current);
                StatusDetail.Text = Strings.Get("updates.checkingDetail");
                SetAction(Strings.Get("updates.checkAction"), SymbolRegular.ArrowSync24, primary: false);
                break;

            case UpdateStatus.UpToDate upToDate:
                StatusTitle.Text = Strings.Get("updates.upToDateTitle");
                StatusDetail.Text = string.Format(Strings.Get("updates.upToDateDetail"), current, upToDate.CheckedAt.ToString("t"));
                SetAction(Strings.Get("updates.checkAction"), SymbolRegular.ArrowSync24, primary: false);
                break;

            case UpdateStatus.Failed failed:
                StatusTitle.Text = failed.Release is { } release
                    ? string.Format(Strings.Get("updates.failedAvailableTitle"), release.Version.ToString(3))
                    : string.Format(Strings.Get("updates.failedTitle"), current);
                StatusDetail.Text = string.Format(Strings.Get("updates.failedDetail"), current);
                Problem.Message = failed.Message;
                Problem.IsOpen = true;
                if (failed.Release is not null) SetAction(Strings.Get("updates.tryAgainAction"), SymbolRegular.ArrowDownload24, primary: true);
                else SetAction(Strings.Get("updates.checkAction"), SymbolRegular.ArrowSync24, primary: false);
                break;

            default:
                StatusTitle.Text = string.Format(Strings.Get("updates.defaultTitle"), current);
                StatusDetail.Text = _settings.LastUpdateCheck is { } last
                    ? string.Format(Strings.Get("updates.lastChecked"), last.ToLocalTime().ToString("g"))
                    : Strings.Get("updates.notCheckedYet");
                SetAction(Strings.Get("updates.checkAction"), SymbolRegular.ArrowSync24, primary: false);
                break;
        }
    }

    private void SetAction(string text, SymbolRegular symbol, bool primary)
    {
        ActionButton.Content = text;
        ActionButton.Icon = new SymbolIcon { Symbol = symbol };
        ActionButton.Appearance = primary ? ControlAppearance.Primary : ControlAppearance.Secondary;
    }

    private async void OnAction(object sender, RoutedEventArgs e)
    {
        if (_updates.Status is UpdateStatus.Available or UpdateStatus.Failed { Release: not null })
        {
            await _installUpdate();
        }
        else
        {
            await _updates.CheckAsync();
        }
    }

    private void OnAutoCheckChanged(object sender, RoutedEventArgs e)
    {
        _settings.CheckForUpdates = AutoCheck.IsChecked == true;
        _settings.Save();
        _scheduleChanged();
    }

    private void OnReleaseNotes(object sender, RoutedEventArgs e)
    {
        var url = _updates.Status switch
        {
            UpdateStatus.Available available => available.Release.PageUrl,
            UpdateStatus.Failed { Release: { } release } => release.PageUrl,
            _ => ReleasesUrl,
        };
        Shell.OpenUrl(url);
    }
}
