namespace JobTrack.Host.Hosting;

/// <summary>
/// Makes sure there is exactly one JobTrack per signed-in user, and gives other processes two ways
/// to talk to it.
/// </summary>
/// <remarks>
/// Three callers need this, and they are why the names are what they are:
///
/// <list type="bullet">
/// <item>A second launch — the Start Menu shortcut clicked while it is already running. It fails
/// to take the mutex, signals <c>Show</c>, and exits. The user gets the UI opened, not a second
/// tray icon and an EADDRINUSE.</item>
/// <item>The installer, upgrading over a running copy. Without a way to stop it first, JobTrack.exe
/// and libvips-42.dll are locked and the install fails halfway.</item>
/// <item>The uninstaller, for the same reason.</item>
/// </list>
///
/// Everything is in the <c>Local\</c> namespace, which is per-session. A per-user installer runs in
/// the same session as the app, so both the installer and <c>JobTrack.exe --quit</c> can reach it.
/// An elevated uninstall from a different session cannot, which is why the Inno script keeps a
/// taskkill fallback — and why the job object exists to clean up node when that happens.
/// </remarks>
internal sealed class SingleInstance : IDisposable
{
    private const string MutexName = @"Local\JobTrack.Host.Instance";
    private const string QuitEventName = @"Local\JobTrack.Host.Quit";
    private const string ShowEventName = @"Local\JobTrack.Host.Show";

    private readonly Mutex _mutex;
    private readonly EventWaitHandle _quit;
    private readonly EventWaitHandle _show;
    private readonly CancellationTokenSource _stopWaiting = new();

    private SingleInstance(Mutex mutex, EventWaitHandle quit, EventWaitHandle show)
    {
        _mutex = mutex;
        _quit = quit;
        _show = show;
    }

    /// <summary>Raised when another process asked this one to shut down.</summary>
    public event Action? QuitRequested;

    /// <summary>Raised when another process asked this one to show itself.</summary>
    public event Action? ShowRequested;

    /// <summary>
    /// Claims ownership, or returns null if another instance already holds it.
    /// </summary>
    public static SingleInstance? TryAcquire()
    {
        var mutex = new Mutex(initiallyOwned: true, MutexName, out var isOwner);
        if (!isOwner)
        {
            mutex.Dispose();
            return null;
        }

        var quit = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName);
        var show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        return new SingleInstance(mutex, quit, show);
    }

    /// <summary>Starts listening for the two signals. Call once the app is ready to act on them.</summary>
    public void BeginListening()
    {
        Listen(_quit, () => QuitRequested?.Invoke());
        Listen(_show, () => ShowRequested?.Invoke());
    }

    private void Listen(EventWaitHandle handle, Action onSignal)
    {
        var thread = new Thread(() =>
        {
            var handles = new[] { handle, _stopWaiting.Token.WaitHandle };
            while (WaitHandle.WaitAny(handles) == 0) onSignal();
        })
        { IsBackground = true, Name = "JobTrack signal listener" };
        thread.Start();
    }

    /// <summary>
    /// Signals the running instance to quit and waits for it to actually be gone.
    /// </summary>
    /// <returns>False if it was still running when the timeout elapsed.</returns>
    public static bool SignalQuitAndWait(TimeSpan timeout)
    {
        if (!EventWaitHandle.TryOpenExisting(QuitEventName, out var quit)) return true; // Not running.
        using (quit) quit.Set();

        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            // The mutex becoming openable-but-unowned is the signal we want; the simplest reliable
            // test is whether it exists at all, since the owner disposes it on the way out.
            if (!Mutex.TryOpenExisting(MutexName, out var mutex)) return true;
            mutex.Dispose();
            Thread.Sleep(200);
        }
        return false;
    }

    /// <summary>Asks a running instance to open the UI. No-op when nothing is running.</summary>
    public static void SignalShow()
    {
        if (!EventWaitHandle.TryOpenExisting(ShowEventName, out var show)) return;
        using (show) show.Set();
    }

    public void Dispose()
    {
        _stopWaiting.Cancel();
        _quit.Dispose();
        _show.Dispose();
        try { _mutex.ReleaseMutex(); } catch (ApplicationException) { /* Not owned; nothing to do. */ }
        _mutex.Dispose();
        _stopWaiting.Dispose();
    }
}
