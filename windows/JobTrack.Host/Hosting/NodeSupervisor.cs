using System.Text;
using System.Text.Json;
using JobTrack.Host.Config;

namespace JobTrack.Host.Hosting;

internal enum ServerState { Stopped, Starting, Running, Restarting, Failed }

/// <summary>
/// Owns the <c>node.exe</c> that serves JobTrack: starts it, watches it, restarts it, and stops it
/// cleanly.
/// </summary>
/// <remarks>
/// This class is the reason the Windows build exists. Today nothing supervises the server: an
/// autostart plus a manual launch collides on the port with an unhandled rejection, a crash leaves
/// nothing running with no indication why, and switching database targets works by having the
/// server exit and *assuming* something outside will bring it back (ROADMAP.md item 5 says as
/// much). One supervisor answers all three.
///
/// Exits are classified by <em>intent</em>, not by exit code. Anything the host did not ask for is
/// a restart — which covers a crash and the deliberate self-exit after a database switch with the
/// same rule, and needs no cooperation from the server to tell them apart.
/// </remarks>
internal sealed class NodeSupervisor : IDisposable
{
    /// <summary>Matches <c>EXIT_PORT_IN_USE</c> in apps/tray/src/server.ts.</summary>
    private const int ExitPortInUse = 3;

    private const string ReadyPrefix = "JOBTRACK_READY ";
    private const string ErrorPrefix = "JOBTRACK_ERROR ";

    private static readonly TimeSpan[] Backoff =
    [
        TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(30),
    ];

    /// <summary>After this many starts that never reached ready, stop trying and say so.</summary>
    private const int MaxFailedStarts = 5;

    private readonly LaunchManifest _manifest;
    private readonly RollingLog _serverLog;
    private readonly RollingLog _hostLog;
    private readonly JobObject _job = new();
    private readonly Lock _gate = new();

    private Process? _process;
    private bool _stopRequested;
    private int _failedStarts;
    private CancellationTokenSource? _restartTimer;

    public NodeSupervisor(LaunchManifest manifest, RollingLog hostLog, RollingLog serverLog)
    {
        _manifest = manifest;
        _hostLog = hostLog;
        _serverLog = serverLog;
    }

    public ServerState State { get; private set; } = ServerState.Stopped;

    public ReadyInfo? Ready { get; private set; }

    /// <summary>Set when the server named a reason it could not start; cleared on the next start.</summary>
    public ServerError? LastError { get; private set; }

    public event Action<ServerState>? StateChanged;

    public void Start()
    {
        lock (_gate)
        {
            if (_process is { HasExited: false }) return;
            _stopRequested = false;
            LastError = null;
            Ready = null;
            SetState(_failedStarts > 0 ? ServerState.Restarting : ServerState.Starting);

            var startInfo = new ProcessStartInfo
            {
                FileName = _manifest.NodeExe,
                WorkingDirectory = _manifest.WorkingDirectory,
                // The two properties this whole application exists for. Without them the server
                // gets a console window, which is exactly the behavior being fixed.
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false),
            };
            foreach (var argument in _manifest.BuildArguments()) startInfo.ArgumentList.Add(argument);

            startInfo.Environment["JOBTRACK_HOME"] = Paths.JobtrackHome;
            // tsx searches *upward* for a tsconfig.json. Left alone, an unrelated one above the
            // install directory would silently change how the app's TypeScript is transpiled.
            if (_manifest.Tsconfig is { } tsconfig) startInfo.Environment["TSX_TSCONFIG_PATH"] = Paths.Resolve(tsconfig);
            // A user-global NODE_OPTIONS is a genuine way to break the loader, and nothing here
            // wants to inherit an ambient NODE_ENV either.
            startInfo.Environment.Remove("NODE_OPTIONS");
            startInfo.Environment.Remove("NODE_ENV");

            var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, e) => OnLine(e.Data, "[out]");
            process.ErrorDataReceived += (_, e) => OnLine(e.Data, "[err]");
            process.Exited += (_, _) => OnExited(process);

            _hostLog.Write($"starting {_manifest.NodeExe} {string.Join(' ', _manifest.BuildArguments())}");
            process.Start();
            // Immediately, so nothing the server spawns escapes the guarantee.
            _job.Assign(process);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            _process = process;
        }
    }

    /// <summary>Asks the server to shut down cleanly, then makes sure it is gone.</summary>
    public async Task StopAsync(TimeSpan? timeout = null)
    {
        Process? process;
        lock (_gate)
        {
            _stopRequested = true;
            _restartTimer?.Cancel();
            process = _process;
        }
        if (process is null || process.HasExited)
        {
            SetState(ServerState.Stopped);
            return;
        }

        // `quit` on stdin, not a kill: it runs the server's own shutdown path, which closes SQLite
        // properly. Windows gives one process no dependable way to send another something like
        // SIGTERM, so this is the only clean option short of a named pipe.
        try
        {
            _hostLog.Write("asking the server to quit");
            await process.StandardInput.WriteLineAsync("quit");
            await process.StandardInput.FlushAsync();
        }
        catch (IOException)
        {
            // stdin already closed — it is on its way out regardless.
        }

        using var deadline = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(10));
        try
        {
            await process.WaitForExitAsync(deadline.Token);
        }
        catch (OperationCanceledException)
        {
            _hostLog.Write("the server did not stop when asked; killing it");
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { /* Already gone. */ }
        }
        SetState(ServerState.Stopped);
    }

    public async Task RestartAsync()
    {
        await StopAsync();
        lock (_gate) { _failedStarts = 0; }
        Start();
    }

    private void OnLine(string? line, string stream)
    {
        if (line is null) return;
        _serverLog.Write($"{stream} {line}");

        if (line.StartsWith(ReadyPrefix, StringComparison.Ordinal))
        {
            try
            {
                Ready = JsonSerializer.Deserialize<ReadyInfo>(line[ReadyPrefix.Length..]);
                lock (_gate) { _failedStarts = 0; }
                SetState(ServerState.Running);
                _hostLog.Write($"ready at {Ready?.Url} (v{Ready?.Version}, {Ready?.Driver})");
            }
            catch (JsonException error)
            {
                _hostLog.Write($"could not read the ready line: {error.Message}");
            }
        }
        else if (line.StartsWith(ErrorPrefix, StringComparison.Ordinal))
        {
            try
            {
                LastError = JsonSerializer.Deserialize<ServerError>(line[ErrorPrefix.Length..]);
                _hostLog.Write($"the server reported {LastError?.Code} on port {LastError?.Port}");
            }
            catch (JsonException) { /* Nothing actionable; the raw line is in server.log. */ }
        }
    }

    private void OnExited(Process process)
    {
        int exitCode;
        try { exitCode = process.ExitCode; } catch (InvalidOperationException) { exitCode = -1; }

        lock (_gate)
        {
            if (!ReferenceEquals(process, _process)) return; // A stale handle from an earlier run.
            _process = null;

            if (_stopRequested)
            {
                _hostLog.Write($"the server stopped as asked (exit {exitCode})");
                SetState(ServerState.Stopped);
                return;
            }

            // Never restart-loop into a port that is already taken; the tray offers the user a
            // real choice instead (open the other instance, or change the port).
            if (exitCode == ExitPortInUse)
            {
                _hostLog.Write("the port is already in use; not restarting");
                SetState(ServerState.Failed);
                return;
            }

            var reachedReady = Ready is not null;
            if (!reachedReady && ++_failedStarts >= MaxFailedStarts)
            {
                _hostLog.Write($"giving up after {_failedStarts} starts that never became ready");
                SetState(ServerState.Failed);
                return;
            }

            // Everything else is a restart, and deliberately so: a crash and the self-exit that
            // POST /api/db/switch performs are the same situation from out here — the server is
            // gone and nobody asked for that — and both want the same response.
            var wait = Backoff[Math.Min(_failedStarts, Backoff.Length - 1)];
            _hostLog.Write($"the server exited unexpectedly (code {exitCode}); restarting in {wait.TotalSeconds:0}s");
            SetState(ServerState.Restarting);
            ScheduleRestart(wait);
        }
    }

    private void ScheduleRestart(TimeSpan wait)
    {
        _restartTimer?.Cancel();
        _restartTimer?.Dispose();
        var timer = new CancellationTokenSource();
        _restartTimer = timer;
        _ = Task.Delay(wait, timer.Token).ContinueWith(
            task => { if (!task.IsCanceled) Start(); },
            TaskScheduler.Default);
    }

    private void SetState(ServerState state)
    {
        if (State == state) return;
        State = state;
        StateChanged?.Invoke(state);
    }

    public void Dispose()
    {
        _restartTimer?.Cancel();
        _restartTimer?.Dispose();
        // Closing the job handle terminates node even if everything above went wrong.
        _job.Dispose();
        _process?.Dispose();
    }
}
