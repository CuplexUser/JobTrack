using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using JobTrack.Host.Hosting;
using JobTrack.Host.Resources;
using Microsoft.Win32;

namespace JobTrack.Host.UI.Settings;

/// <summary>
/// Automatic backups: the folder, the schedule and how long backups are kept.
/// </summary>
/// <remarks>
/// Unlike the other pages, nothing here goes into <see cref="SettingsModel"/> or waits for the
/// window's Save: the running server owns these settings (apps/api/src/backup/config-store.ts)
/// and this page reads and writes them through <see cref="BackupClient"/>, so its own Save
/// applies at once. Encryption keys are only shown here and are set up in the browser, where a
/// generated secret key can be copied or downloaded.
/// </remarks>
internal partial class BackupPage : Page
{
    private static readonly Regex TimeOfDay = new(@"^([01]\d|2[0-3]):[0-5]\d$");

    private readonly BackupClient _client;
    private readonly ISettingsHost _host;
    private readonly Func<string?> _webUrl;
    private readonly CheckBox[] _weekdays = new CheckBox[7];
    private JsonObject? _config;

    public BackupPage(BackupClient client, ISettingsHost host, Func<string?> webUrl)
    {
        _client = client;
        _host = host;
        _webUrl = webUrl;
        InitializeComponent();

        // Monday first, as a week is laid out here; the server numbers days from Sunday = 0.
        foreach (var day in new[] { 1, 2, 3, 4, 5, 6, 0 })
        {
            var box = new CheckBox { Margin = new Thickness(0, 0, 12, 0), MinWidth = 0 };
            _weekdays[day] = box;
            WeekdaysPanel.Children.Add(box);
        }

        Loaded += async (_, _) => await LoadAsync();
    }

    // ------------------------------------------------------------------------------------ load

    private async Task LoadAsync()
    {
        var names = Strings.Culture.DateTimeFormat.AbbreviatedDayNames;
        for (var day = 0; day < 7; day++) _weekdays[day].Content = names[day];

        SetBusy(true);
        try
        {
            Show(await _client.GetStatusAsync());
            SetEditable(true);
        }
        catch (BackupClientException error)
        {
            StatusTitle.Text = Strings.Get("backup.unavailableTitle");
            StatusDetail.Text = error.Message;
            SetEditable(false);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void Show(BackupStatus status)
    {
        _config = status.Config;
        var state = status.State;

        StatusTitle.Text = state.LastSuccessAt is { } last
            ? string.Format(Strings.Get("backup.lastBackup"), FormatTime(last))
            : Strings.Get("backup.noBackupYet");
        StatusDetail.Text = status.NextRunAt is { } next
            ? string.Format(Strings.Get("backup.nextBackup"), FormatTime(next))
            : Strings.Get("backup.off");

        Problem.IsOpen = state.LastError is not null;
        if (state.LastError is { } error)
        {
            Problem.Message = string.Format(Strings.Get("backup.lastFailed"), FormatTime(state.LastRunAt), error);
        }

        var config = status.Config;
        EnabledSwitch.IsChecked = config["enabled"]?.GetValue<bool>() ?? false;
        FolderBox.Text = config["destination"]?["path"]?.GetValue<string>() ?? "";

        var schedule = config["schedule"];
        var frequency = schedule?["frequency"]?.GetValue<string>() ?? "daily";
        FrequencyBox.SelectedItem = FrequencyBox.Items.Cast<ComboBoxItem>().First(item => (string)item.Tag == frequency);
        EveryHoursBox.Value = schedule?["everyHours"]?.GetValue<int>() ?? 6;
        TimeBox.Text = schedule?["time"]?.GetValue<string>() ?? "02:00";
        var days = schedule?["weekdays"]?.AsArray().Select(day => day!.GetValue<int>()).ToHashSet() ?? [0];
        for (var day = 0; day < 7; day++) _weekdays[day].IsChecked = days.Contains(day);
        SkipUnchangedSwitch.IsChecked = config["skipUnchanged"]?.GetValue<bool>() ?? true;

        var retention = config["retention"];
        KeepLastBox.Value = retention?["keepLast"]?.GetValue<int>() ?? 0;
        MaxAgeBox.Value = retention?["maxAgeDays"]?.GetValue<int>() ?? 0;

        var encryption = config["encryption"];
        EncryptionHeader.Description = (encryption?["mode"]?.GetValue<string>() ?? "none") switch
        {
            "passphrase" => Strings.Get("backup.encryptionPassphrase"),
            "recipients" => string.Format(Strings.Get("backup.encryptionKeys"), encryption?["recipients"]?.AsArray().Count ?? 0),
            _ => Strings.Get("backup.encryptionNone"),
        };

        UpdateScheduleVisibility();
    }

    private static string FormatTime(string? iso) =>
        iso is not null && DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at)
            ? at.ToLocalTime().ToString("g", Strings.Culture)
            : "";

    // ----------------------------------------------------------------------------------- edits

    private string SelectedFrequency => (FrequencyBox.SelectedItem as ComboBoxItem)?.Tag as string ?? "daily";

    private void OnFrequencyChanged(object sender, SelectionChangedEventArgs e) => UpdateScheduleVisibility();

    private void UpdateScheduleVisibility()
    {
        var frequency = SelectedFrequency;
        HoursPanel.Visibility = frequency == "hourly" ? Visibility.Visible : Visibility.Collapsed;
        TimePanel.Visibility = frequency == "hourly" ? Visibility.Collapsed : Visibility.Visible;
        WeekdaysCard.Visibility = frequency == "weekly" ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnBrowse(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = Strings.Get("backup.browseTitle") };
        if (Directory.Exists(FolderBox.Text)) dialog.InitialDirectory = FolderBox.Text;
        if (dialog.ShowDialog(Window.GetWindow(this)) == true) FolderBox.Text = dialog.FolderName;
    }

    /// <summary>The settings as edited, or null (after saying why) when something is not valid yet.</summary>
    private async Task<JsonObject?> EditedConfigAsync()
    {
        if (_config is null) return null;

        var time = TimeBox.Text.Trim();
        if (SelectedFrequency != "hourly" && !TimeOfDay.IsMatch(time))
        {
            await _host.ShowMessageAsync(Strings.Get("backup.notSavedTitle"), Strings.Get("backup.badTime"));
            return null;
        }
        var days = Enumerable.Range(0, 7).Where(day => _weekdays[day].IsChecked == true).ToList();
        if (SelectedFrequency == "weekly" && days.Count == 0)
        {
            await _host.ShowMessageAsync(Strings.Get("backup.notSavedTitle"), Strings.Get("backup.noWeekdays"));
            return null;
        }

        var config = (JsonObject)_config.DeepClone();
        config["enabled"] = EnabledSwitch.IsChecked == true;
        config["destination"] = new JsonObject { ["kind"] = "folder", ["path"] = FolderBox.Text.Trim() };
        var schedule = (JsonObject?)_config["schedule"]?.DeepClone() ?? [];
        schedule["frequency"] = SelectedFrequency;
        schedule["everyHours"] = (int)(EveryHoursBox.Value ?? 6);
        if (TimeOfDay.IsMatch(time)) schedule["time"] = time;
        if (days.Count > 0) schedule["weekdays"] = new JsonArray(days.Select(day => (JsonNode)day).ToArray());
        config["schedule"] = schedule;
        config["skipUnchanged"] = SkipUnchangedSwitch.IsChecked == true;
        // Zero, or an emptied box, means no limit, which the server spells as null.
        config["retention"] = new JsonObject
        {
            ["keepLast"] = KeepLastBox.Value is > 0 and var keep ? (int)keep : null,
            ["maxAgeDays"] = MaxAgeBox.Value is > 0 and var age ? (int)age : null,
        };
        return config;
    }

    // --------------------------------------------------------------------------------- actions

    private async void OnSave(object sender, RoutedEventArgs e)
    {
        if (await EditedConfigAsync() is not { } config) return;
        SetBusy(true);
        try
        {
            Show(await _client.SaveAsync(config));
            _host.ShowToast(Strings.Get("backup.savedTitle"), Strings.Get("backup.savedMessage"));
        }
        catch (BackupClientException error)
        {
            await _host.ShowMessageAsync(Strings.Get("backup.notSavedTitle"), error.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void OnTest(object sender, RoutedEventArgs e)
    {
        if (await EditedConfigAsync() is not { } config) return;
        SetBusy(true);
        try
        {
            var result = await _client.TestAsync(config);
            if (result.Ok) _host.ShowToast(Strings.Get("backup.testOkTitle"), Strings.Get("backup.testOkMessage"));
            else await _host.ShowMessageAsync(Strings.Get("backup.testFailedTitle"), string.Join(Environment.NewLine, result.Problems));
        }
        catch (BackupClientException error)
        {
            await _host.ShowMessageAsync(Strings.Get("backup.testFailedTitle"), error.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void OnRunNow(object sender, RoutedEventArgs e)
    {
        SetBusy(true);
        try
        {
            var result = await _client.RunNowAsync();
            _host.ShowToast(Strings.Get("backup.runDoneTitle"), result.File ?? "");
        }
        catch (BackupClientException error)
        {
            await _host.ShowMessageAsync(Strings.Get("backup.runFailedTitle"), error.Message);
        }
        finally
        {
            SetBusy(false);
            // A failed run is recorded too, so the status is worth reloading either way.
            try
            {
                Show(await _client.GetStatusAsync());
            }
            catch (BackupClientException)
            {
                // The server went away mid-run; the next visit to this page reloads it.
            }
        }
    }

    private void OnOpenEncryption(object sender, RoutedEventArgs e)
    {
        if (_webUrl() is { } url) Shell.OpenUrl($"{url.TrimEnd('/')}/settings");
    }

    private void SetBusy(bool busy)
    {
        Busy.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        SaveButton.IsEnabled = TestButton.IsEnabled = RunNowButton.IsEnabled = !busy && _config is not null;
    }

    private void SetEditable(bool editable)
    {
        SaveButton.IsEnabled = TestButton.IsEnabled = RunNowButton.IsEnabled = editable;
    }
}
