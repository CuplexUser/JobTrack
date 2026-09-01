using System.Text;
using System.Text.RegularExpressions;

namespace JobTrack.Host.Config;

/// <summary>
/// Reads and writes <c>%APPDATA%\jobtrack\.env</c> without destroying it.
/// </summary>
/// <remarks>
/// The settings dialog edits the same file the npm package reads, so the two channels can never
/// drift into different config formats. That makes preservation the whole job here: the file is
/// seeded from <c>.env.example</c>, which is eleven commented-out keys with a paragraph of
/// documentation above each one, and a settings dialog that rewrote it as a bare list of key=value
/// pairs would be strictly worse than the Notepad it replaced.
///
/// So the file is modeled as an ordered list of lines, and <see cref="Set"/> prefers, in order:
/// replace the value of an active key in place; otherwise uncomment the template line for that key
/// in place, which keeps every setting sitting under its own explanation; and only if neither
/// exists, append.
///
/// Parsing follows what Node's built-in <c>process.loadEnvFile</c> accepts, since that — not
/// dotenv — is what actually reads this file (apps/api/src/config.ts).
/// </remarks>
internal sealed partial class EnvFile
{
    private readonly List<Line> _lines;
    private readonly string _newline;

    private EnvFile(List<Line> lines, string newline)
    {
        _lines = lines;
        _newline = newline;
    }

    private abstract record Line;
    private sealed record Raw(string Text) : Line;
    private sealed record Entry(string Key, string Value, bool Commented, string Text) : Line;

    [GeneratedRegex(@"^(?<indent>\s*)(?<hash>#\s*)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=(?<value>.*)$")]
    private static partial Regex EntryPattern();

    public static EnvFile Parse(string content)
    {
        // Keep whatever the file already used. This repo is developed on Windows, and rewriting a
        // file's line endings makes a one-key change look like a whole-file diff.
        var newline = content.Contains("\r\n") ? "\r\n" : "\n";
        var lines = new List<Line>();

        foreach (var text in content.Split('\n'))
        {
            var line = text.TrimEnd('\r');
            var match = EntryPattern().Match(line);
            lines.Add(match.Success
                ? new Entry(match.Groups["key"].Value, Unquote(match.Groups["value"].Value.Trim()),
                    match.Groups["hash"].Success, line)
                : new Raw(line));
        }

        // Split always yields a trailing empty piece for a file ending in a newline; drop it so
        // saving does not add a blank line every time.
        if (lines.Count > 0 && lines[^1] is Raw { Text: "" }) lines.RemoveAt(lines.Count - 1);
        return new EnvFile(lines, newline);
    }

    public static EnvFile Load(string path, string? seedFrom = null)
    {
        if (!File.Exists(path) && seedFrom is not null && File.Exists(seedFrom))
        {
            // Same seeding apps/tray/src/settings.ts does, so the dialog always opens onto a
            // documented file rather than an empty one.
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.Copy(seedFrom, path);
        }
        return Parse(File.Exists(path) ? File.ReadAllText(path) : string.Empty);
    }

    /// <summary>The active value for a key, or null when it is absent or commented out.</summary>
    public string? Get(string key)
    {
        foreach (var line in _lines)
        {
            if (line is Entry { Commented: false } entry && entry.Key == key) return entry.Value;
        }
        return null;
    }

    public string GetOrDefault(string key, string fallback) => Get(key) is { Length: > 0 } value ? value : fallback;

    public bool GetBool(string key, bool fallback) =>
        Get(key) switch { "true" => true, "false" => false, _ => fallback };

    public void Set(string key, string value)
    {
        if (value.Contains('\n') || value.Contains('\r'))
        {
            throw new ArgumentException("A .env value cannot contain a line break.", nameof(value));
        }

        var text = $"{key}={Quote(value)}";

        for (var i = 0; i < _lines.Count; i++)
        {
            if (_lines[i] is not Entry entry || entry.Key != key) continue;
            // An active entry wins; otherwise the first commented one gets uncommented where it
            // stands, keeping it under the documentation that explains it.
            if (!entry.Commented)
            {
                _lines[i] = new Entry(key, value, false, text);
                return;
            }
        }

        for (var i = 0; i < _lines.Count; i++)
        {
            if (_lines[i] is Entry { Commented: true } commented && commented.Key == key)
            {
                _lines[i] = new Entry(key, value, false, text);
                return;
            }
        }

        if (_lines.Count > 0 && _lines[^1] is not Raw { Text: "" }) _lines.Add(new Raw(""));
        _lines.Add(new Raw("# Added by JobTrack Settings"));
        _lines.Add(new Entry(key, value, false, text));
    }

    /// <summary>
    /// Returns a key to its default by commenting it out again, keeping the value visible so the
    /// change is reversible by hand.
    /// </summary>
    public void Unset(string key)
    {
        for (var i = 0; i < _lines.Count; i++)
        {
            if (_lines[i] is not Entry { Commented: false } entry || entry.Key != key) continue;
            _lines[i] = new Entry(key, entry.Value, true, $"# {entry.Text}");
        }
    }

    /// <summary>Sets a key, or unsets it when the value is blank — what an empty text box means.</summary>
    public void SetOrUnset(string key, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) Unset(key);
        else Set(key, value.Trim());
    }

    public string Render() => string.Join(_newline, _lines.Select(line => line switch
    {
        Entry entry => entry.Text,
        Raw raw => raw.Text,
        _ => string.Empty,
    })) + _newline;

    /// <summary>
    /// Writes via a temp file so an interrupted save cannot leave a half-written .env — which the
    /// server would then refuse to start from.
    /// </summary>
    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        // No BOM: Node's parser would read one as part of the first key's name.
        File.WriteAllText(temp, Render(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

        if (File.Exists(path)) File.Replace(temp, path, path + ".bak", ignoreMetadataErrors: true);
        else File.Move(temp, path);
    }

    private static string Unquote(string value)
    {
        if (value.Length >= 2 && (value[0] == '"' || value[0] == '\'') && value[^1] == value[0])
        {
            return value[1..^1];
        }
        // An unquoted value ends at an inline comment, matching Node's parser.
        var hash = value.IndexOf(" #", StringComparison.Ordinal);
        return (hash >= 0 ? value[..hash] : value).Trim();
    }

    private static string Quote(string value)
    {
        if (value.Length == 0) return string.Empty;
        var needsQuotes = value != value.Trim()
                          || value.Contains(' ') || value.Contains('#') || value.Contains('"') || value.Contains('\'');
        if (!needsQuotes) return value;
        // Single quotes first, so JSON values such as DB_TARGETS keep their double quotes intact.
        return value.Contains('\'') ? $"\"{value.Replace("\"", "\\\"")}\"" : $"'{value}'";
    }
}
