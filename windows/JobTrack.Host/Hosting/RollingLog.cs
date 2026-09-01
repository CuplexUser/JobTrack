using System.Text;
using System.Text.RegularExpressions;
using JobTrack.Host.Config;

namespace JobTrack.Host.Hosting;

/// <summary>
/// A small append-only log with size-based rotation.
/// </summary>
/// <remarks>
/// The server's stdout and stderr have nowhere to go once there is no console — which is the whole
/// design — so they come here instead. Two files, deliberately: <c>server.log</c> is the Node
/// process verbatim, and <c>host.log</c> is what this application decided and why. When something
/// goes wrong, "which of the two is confused" is the first question, and one interleaved file
/// makes it harder to answer rather than easier.
/// </remarks>
internal sealed partial class RollingLog : IDisposable
{
    private const long MaxBytes = 2 * 1024 * 1024;
    private const int KeepGenerations = 3;

    private readonly string _path;
    private readonly Lock _gate = new();
    private StreamWriter? _writer;

    public RollingLog(string fileName)
    {
        Directory.CreateDirectory(Paths.LogDir);
        _path = Path.Combine(Paths.LogDir, fileName);
        Open();
    }

    public void Write(string line)
    {
        lock (_gate)
        {
            if (_writer is null) return;
            _writer.WriteLine($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {Redact(line)}");
            if (_writer.BaseStream.Length > MaxBytes) Rotate();
        }
    }

    /// <summary>The last <paramref name="lines"/> lines, for the log viewer.</summary>
    public string Tail(int lines)
    {
        lock (_gate)
        {
            _writer?.Flush();
            if (!File.Exists(_path)) return string.Empty;
            try
            {
                // Shared read: the writer above still holds the file open.
                using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                using var reader = new StreamReader(stream);
                var window = new Queue<string>(lines);
                while (reader.ReadLine() is { } line)
                {
                    if (window.Count == lines) window.Dequeue();
                    window.Enqueue(line);
                }
                return string.Join(Environment.NewLine, window);
            }
            catch (IOException)
            {
                return string.Empty;
            }
        }
    }

    /// <summary>
    /// Strips the password out of a connection URL. DATABASE_URL turns up in Fastify's startup
    /// output and in config errors, and a log file is exactly the sort of thing that gets pasted
    /// into a bug report.
    /// </summary>
    internal static string Redact(string line) => ConnectionUrlPassword().Replace(line, "$1****$3");

    [GeneratedRegex("(://[^:/@\\s]+:)([^@\\s]+)(@)")]
    private static partial Regex ConnectionUrlPassword();

    private void Open()
    {
        try
        {
            _writer = new StreamWriter(
                new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite),
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false))
            { AutoFlush = true };
        }
        catch (IOException)
        {
            // A log that cannot be opened must never stop the app from running.
            _writer = null;
        }
    }

    private void Rotate()
    {
        _writer?.Dispose();
        _writer = null;
        try
        {
            var oldest = $"{_path}.{KeepGenerations}";
            if (File.Exists(oldest)) File.Delete(oldest);
            for (var generation = KeepGenerations - 1; generation >= 1; generation--)
            {
                var from = $"{_path}.{generation}";
                if (File.Exists(from)) File.Move(from, $"{_path}.{generation + 1}", overwrite: true);
            }
            File.Move(_path, $"{_path}.1", overwrite: true);
        }
        catch (IOException)
        {
            // Rotation is housekeeping; failing it is not worth interrupting anything for.
        }
        Open();
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _writer?.Dispose();
            _writer = null;
        }
    }
}
