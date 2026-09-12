using System.Text.Json;
using System.Text.Json.Serialization;

namespace JobTrack.Host.Hosting;

/// <summary>
/// Asks the running server what is due, and says so when something new comes due.
/// </summary>
/// <remarks>
/// Reads <c>GET /api/agenda</c>, the same list the dashboard and the MCP server use, so the tray
/// can never disagree with them about what is due. Only the two lists with dates the user chose
/// are announced: follow-ups and people to get back in touch with. Quiet applications and idle
/// openings are prompts to look, not appointments, and a balloon for them would be nagging.
///
/// Each item is announced once per date. The key includes the due date, so moving a follow-up to
/// next week and letting it come due again announces it again, while the half-hourly poll in
/// between stays silent. The memory of what was announced lives only as long as the process;
/// after a restart, whatever is still due is announced once more, which is the right reminder.
/// </remarks>
internal sealed class ReminderPoller : IDisposable
{
    private static readonly TimeSpan FirstPollDelay = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(30);

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly Func<string?> _token;
    private readonly RollingLog _log;
    private readonly HashSet<string> _announced = [];
    private System.Threading.Timer? _timer;
    private string? _baseUrl;
    private int _polling;

    /// <summary>Raised on a thread-pool thread when newly due items are found.</summary>
    public event Action<DueReminders>? RemindersDue;

    public ReminderPoller(Func<string?> token, RollingLog log)
    {
        _token = token;
        _log = log;
    }

    /// <summary>Start polling the server at <paramref name="port"/> on this machine.</summary>
    public void Start(int port)
    {
        // Always the loopback address, whatever HOST says: the server listens there even when
        // bound to 0.0.0.0, and the tray has no business going over the network to reach itself.
        _baseUrl = $"http://127.0.0.1:{port}";
        _timer ??= new System.Threading.Timer(_ => _ = PollAsync(), null, FirstPollDelay, PollInterval);
    }

    public void Stop()
    {
        _timer?.Dispose();
        _timer = null;
        _baseUrl = null;
    }

    private async Task PollAsync()
    {
        // A slow server must not stack polls on top of each other.
        if (Interlocked.Exchange(ref _polling, 1) == 1) return;
        try
        {
            if (_baseUrl is not { } baseUrl) return;

            using var request = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/api/agenda");
            if (_token() is { } token) request.Headers.Add("X-JobTrack-Token", token);

            using var response = await _http.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                _log.Write($"reminders: agenda answered {(int)response.StatusCode}");
                return;
            }

            var agenda = await JsonSerializer.DeserializeAsync<Agenda>(await response.Content.ReadAsStreamAsync());
            if (agenda is null) return;

            var followUps = agenda.FollowUps
                .Where(item => _announced.Add($"follow-up:{item.Id}:{item.FollowUpOn}"))
                .Select(item => $"{item.JobTitle} at {item.Company?.Name}")
                .ToList();
            var people = agenda.Reconnect
                .Where(person => _announced.Add($"reconnect:{person.Id}:{person.ReconnectOn}"))
                .Select(person => person.Name)
                .ToList();

            if (followUps.Count > 0 || people.Count > 0) RemindersDue?.Invoke(new DueReminders(followUps, people));
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException)
        {
            // The server restarting, or not up yet. The next poll will try again.
            _log.Write($"reminders: {error.GetType().Name}: {error.Message}");
        }
        finally
        {
            Interlocked.Exchange(ref _polling, 0);
        }
    }

    public void Dispose()
    {
        Stop();
        _http.Dispose();
    }

    private sealed class Agenda
    {
        [JsonPropertyName("followUps")] public List<FollowUp> FollowUps { get; init; } = [];
        [JsonPropertyName("reconnect")] public List<Person> Reconnect { get; init; } = [];
    }

    private sealed class FollowUp
    {
        [JsonPropertyName("id")] public string Id { get; init; } = "";
        [JsonPropertyName("jobTitle")] public string JobTitle { get; init; } = "";
        [JsonPropertyName("followUpOn")] public string? FollowUpOn { get; init; }
        [JsonPropertyName("company")] public CompanyRef? Company { get; init; }
    }

    private sealed class CompanyRef
    {
        [JsonPropertyName("name")] public string Name { get; init; } = "";
    }

    private sealed class Person
    {
        [JsonPropertyName("id")] public string Id { get; init; } = "";
        [JsonPropertyName("name")] public string Name { get; init; } = "";
        [JsonPropertyName("reconnectOn")] public string? ReconnectOn { get; init; }
    }
}

/// <summary>What newly came due: follow-ups as "title at company", and people by name.</summary>
internal sealed record DueReminders(IReadOnlyList<string> FollowUps, IReadOnlyList<string> People)
{
    /// <summary>A balloon title and body, kept short: Windows truncates long balloon text.</summary>
    public (string Title, string Message) Describe()
    {
        var parts = new List<string>();
        if (FollowUps.Count > 0) parts.Add(FollowUps.Count == 1 ? "1 follow-up due" : $"{FollowUps.Count} follow-ups due");
        if (People.Count > 0) parts.Add(People.Count == 1 ? "1 person to get back to" : $"{People.Count} people to get back to");
        var title = string.Join(", ", parts);

        var first = FollowUps.Count > 0 ? $"Follow up on {FollowUps[0]}" : $"Get back in touch with {People[0]}";
        var others = FollowUps.Count + People.Count - 1;
        var message = others > 0 ? $"{first}, and {others} more. Click to open the dashboard." : $"{first}. Click to open the dashboard.";
        return (title, message);
    }
}
