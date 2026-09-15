using System.Runtime.CompilerServices;
using System.Text.Json;
using JobTrack.Host.Config;
using JobTrack.Host.Hosting;

namespace JobTrack.Host.UI.Settings;

/// <summary>
/// The values the settings window edits, and the rules for reading, validating and saving them.
/// </summary>
/// <remarks>
/// It writes the same <c>%APPDATA%\jobtrack\.env</c> the npm package reads, never a second,
/// parallel config format, so an installation can be driven from here or from a text editor
/// without the two disagreeing. <see cref="EnvFile"/> does the preserving.
///
/// The web UI's own Settings page deliberately does not do this (its header says so): it switches
/// between already-configured database targets and handles backups. Everything here is the layer
/// underneath that, which the server reads exactly once at boot, which is why the window says
/// changes need a restart rather than pretending otherwise. Autostart and the update check are the
/// exceptions, since they belong to this application rather than to the server.
/// </remarks>
internal sealed class SettingsModel : INotifyPropertyChanged
{
    public static IReadOnlyList<string> Drivers { get; } = ["sqlite", "postgres", "mysql"];
    public static IReadOnlyList<string> HostChoices { get; } = ["127.0.0.1", "0.0.0.0"];

    private readonly LaunchManifest _manifest;
    private readonly HostSettings _hostSettings;
    private readonly EnvFile _env;

    public SettingsModel(LaunchManifest manifest, HostSettings hostSettings)
    {
        _manifest = manifest;
        _hostSettings = hostSettings;
        _env = EnvFile.Load(Paths.EnvFile, manifest.EnvExample is { } example ? Paths.Resolve(example) : null);
        LoadValues();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    // ---------------------------------------------------------------------------------- general

    public string Host { get; set { if (Set(ref field, value)) OnPropertyChanged(nameof(ExposesNetwork)); } } = "127.0.0.1";

    public double Port { get; set => Set(ref field, value); } = 3001;

    /// <summary>A Windows setting rather than part of the JobTrack configuration, so it applies at once.</summary>
    public bool Autostart
    {
        get;
        set
        {
            // Loading reads the registry; it must not write the same value straight back.
            if (Set(ref field, value) && !_loading) Config.Autostart.Set(value);
        }
    }

    public bool OpenBrowserOnStart { get; set => Set(ref field, value); }
    public bool RemindersEnabled { get; set => Set(ref field, value); }
    public bool ConnectClaudeDesktop { get; set => Set(ref field, value); }
    public bool ClaudeDesktopAvailable => McpConfig.IsBundled(_manifest);

    public bool ExposesNetwork => Host.Trim() == "0.0.0.0";

    // --------------------------------------------------------------------------------- database

    public string Driver
    {
        get;
        set
        {
            if (!Set(ref field, value)) return;
            OnPropertyChanged(nameof(IsSqlite));
            OnPropertyChanged(nameof(IsServerDriver));
        }
    } = "sqlite";

    public bool IsSqlite => Driver == "sqlite";
    public bool IsServerDriver => !IsSqlite;
    public string DbFile { get; set => Set(ref field, value); } = "";
    public string DatabaseUrl { get; set => Set(ref field, value); } = "";
    public string DbTargets { get; set => Set(ref field, value); } = "";

    // ----------------------------------------------------------------------------------- search

    public bool SemanticSearch { get; set => Set(ref field, value); }
    public string EmbeddingModel { get; set => Set(ref field, value); } = "";
    public string ModelCacheDir { get; set => Set(ref field, value); } = "";

    // ----------------------------------------------------------------------------------- access

    /// <summary>The token, or null before the server has generated one.</summary>
    public string? Token { get; private set { if (Set(ref field, value)) OnPropertyChanged(nameof(TokenDisplay)); } }

    public bool TokenRevealed { get; set { if (Set(ref field, value)) OnPropertyChanged(nameof(TokenDisplay)); } }

    public string TokenDisplay => Token is null
        ? _tokenPlaceholder
        : TokenRevealed ? Token : new string('•', Math.Min(Token.Length, 32));

    private string _tokenPlaceholder = "Generated when the server first starts";

    public string CorsOrigins { get; set => Set(ref field, value); } = "";

    /// <summary>Whether API_TOKEN is pinned in .env, in which case regenerating would change nothing.</summary>
    public bool TokenIsConfigured => _env.Get("API_TOKEN") is { Length: > 0 };

    // --------------------------------------------------------------------------------- advanced

    public string RawText { get; set => Set(ref field, value); } = "";

    /// <summary>
    /// While the Advanced page is open, the raw text is what gets saved, and the typed controls are
    /// brought back in line with it when it closes. Otherwise a hand edit and a control edit would
    /// silently race.
    /// </summary>
    public bool RawIsAuthoritative { get; private set; }

    // ------------------------------------------------------------------------------------ state

    private bool _loading;

    private void LoadValues()
    {
        _loading = true;
        try { ReadValues(); }
        finally { _loading = false; }
    }

    private void ReadValues()
    {
        Host = _env.GetOrDefault("HOST", "127.0.0.1");
        Port = int.TryParse(_env.Get("PORT"), out var port) && port is >= 1 and <= 65535 ? port : 3001;
        Autostart = Config.Autostart.IsEnabled;
        OpenBrowserOnStart = _hostSettings.OpenBrowserOnStart;
        RemindersEnabled = _hostSettings.RemindersEnabled;
        ConnectClaudeDesktop = _hostSettings.ConnectClaudeDesktop;

        var driver = _env.GetOrDefault("DB_DRIVER", "sqlite");
        Driver = Drivers.Contains(driver) ? driver : "sqlite";
        DbFile = _env.Get("DB_FILE") ?? string.Empty;
        DatabaseUrl = _env.Get("DATABASE_URL") ?? string.Empty;
        DbTargets = _env.Get("DB_TARGETS") ?? string.Empty;

        SemanticSearch = _env.GetBool("SEMANTIC_SEARCH", true);
        EmbeddingModel = _env.Get("EMBEDDING_MODEL") ?? string.Empty;
        ModelCacheDir = _env.Get("MODEL_CACHE_DIR") ?? string.Empty;

        Token = ApiToken.Read(_env);
        CorsOrigins = string.Join(Environment.NewLine,
            (_env.Get("CORS_ORIGINS") ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));

        RawText = _env.Render();
    }

    /// <summary>Called as the Advanced page opens or closes.</summary>
    public void SetRawEditing(bool editing)
    {
        if (editing)
        {
            ApplyTypedValues();
            RawText = _env.Render();
            RawIsAuthoritative = true;
        }
        else if (RawIsAuthoritative)
        {
            AdoptRawText();
            RawIsAuthoritative = false;
        }
    }

    private void AdoptRawText()
    {
        var reparsed = EnvFile.Parse(RawText);
        foreach (var key in new[]
        {
            "HOST", "PORT", "DB_DRIVER", "DB_FILE", "DATABASE_URL", "DB_TARGETS",
            "SEMANTIC_SEARCH", "EMBEDDING_MODEL", "MODEL_CACHE_DIR", "CORS_ORIGINS",
        })
        {
            _env.SetOrUnset(key, reparsed.Get(key));
        }
        LoadValues();
    }

    private void ApplyTypedValues()
    {
        _env.SetOrUnset("HOST", Host.Trim());
        _env.Set("PORT", ((int)Math.Clamp(Port, 1, 65535)).ToString());
        _env.SetOrUnset("DB_DRIVER", Driver);
        _env.SetOrUnset("DB_FILE", DbFile);
        _env.SetOrUnset("DATABASE_URL", DatabaseUrl);
        _env.SetOrUnset("DB_TARGETS", DbTargets.Trim());
        // The server treats only the literal string "false" as off, so writing the word out is
        // both correct and readable in the file.
        _env.Set("SEMANTIC_SEARCH", SemanticSearch ? "true" : "false");
        _env.SetOrUnset("EMBEDDING_MODEL", EmbeddingModel);
        _env.SetOrUnset("MODEL_CACHE_DIR", ModelCacheDir);
        _env.SetOrUnset("CORS_ORIGINS", string.Join(',',
            CorsOrigins.Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0)));
    }

    // ------------------------------------------------------------------------------- validation

    private bool Validate(out string problem)
    {
        problem = string.Empty;

        if (Driver != "sqlite" && DatabaseUrl.Trim().Length == 0)
        {
            problem = $"The {Driver} driver needs a connection URL.";
            return false;
        }

        var targets = DbTargets.Trim();
        if (targets.Length > 0 && !ValidateTargets(targets, out problem)) return false;

        return true;
    }

    /// <summary>
    /// Checks DB_TARGETS against the same rules apps/api/src/db/targets.ts applies, so a bad value
    /// is rejected here rather than stopping the server from starting at all.
    /// </summary>
    private static bool ValidateTargets(string json, out string problem)
    {
        problem = string.Empty;
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                problem = "DB_TARGETS must be a JSON array.";
                return false;
            }

            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var target in document.RootElement.EnumerateArray())
            {
                var name = target.TryGetProperty("name", out var n) ? n.GetString() : null;
                var driver = target.TryGetProperty("driver", out var d) ? d.GetString() : null;

                if (string.IsNullOrWhiteSpace(name)) { problem = "Every target needs a name."; return false; }
                if (name.Equals("default", StringComparison.OrdinalIgnoreCase))
                {
                    problem = "\"default\" is the name of the target configured above; pick another.";
                    return false;
                }
                if (!names.Add(name)) { problem = $"There is more than one target called \"{name}\"."; return false; }
                if (driver is null || !Drivers.Contains(driver))
                {
                    problem = $"Target \"{name}\" has an unknown driver. Use sqlite, postgres or mysql.";
                    return false;
                }
                var needs = driver == "sqlite" ? "file" : "url";
                if (!target.TryGetProperty(needs, out var value) || string.IsNullOrWhiteSpace(value.GetString()))
                {
                    problem = $"Target \"{name}\" uses {driver}, so it needs a \"{needs}\".";
                    return false;
                }
            }
            return true;
        }
        catch (JsonException error)
        {
            problem = $"DB_TARGETS is not valid JSON: {error.Message}";
            return false;
        }
    }

    // ---------------------------------------------------------------------------------- actions

    /// <summary>What happened to a save, for the window to act on.</summary>
    /// <param name="Problem">Why nothing was saved, or null when it was.</param>
    /// <param name="RemindersEnabled">The reminders setting as saved.</param>
    /// <param name="ClaudeDesktopChanged">Whether the Claude Desktop setting changed.</param>
    public sealed record SaveResult(string? Problem, bool RemindersEnabled, bool ClaudeDesktopChanged);

    public SaveResult Save()
    {
        if (RawIsAuthoritative) AdoptRawText();
        else ApplyTypedValues();

        if (!Validate(out var problem)) return new SaveResult(problem, RemindersEnabled, false);

        try
        {
            _env.Save(Paths.EnvFile);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return new SaveResult($"Could not save {Paths.EnvFile}.\n\n{error.Message}", RemindersEnabled, false);
        }

        _hostSettings.OpenBrowserOnStart = OpenBrowserOnStart;
        _hostSettings.RemindersEnabled = RemindersEnabled;
        var claudeDesktopChanged = _hostSettings.ConnectClaudeDesktop != ConnectClaudeDesktop;
        _hostSettings.ConnectClaudeDesktop = ConnectClaudeDesktop;
        _hostSettings.Save();
        return new SaveResult(null, RemindersEnabled, claudeDesktopChanged);
    }

    public void RegenerateToken()
    {
        ApiToken.Regenerate();
        _tokenPlaceholder = "Generated when the server next starts";
        Token = null;
        OnPropertyChanged(nameof(TokenDisplay));
    }

    /// <summary>The model cache folder as the server resolves it.</summary>
    public string ResolvedModelCacheDir()
    {
        var value = string.IsNullOrWhiteSpace(ModelCacheDir) ? ".models" : ModelCacheDir.Trim();
        return Path.IsPathRooted(value) ? value : Path.Combine(Paths.JobtrackHome, value);
    }

    // ------------------------------------------------------------------------------ plumbing

    private bool Set<T>(ref T storage, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(storage, value)) return false;
        storage = value;
        OnPropertyChanged(name);
        return true;
    }

    private void OnPropertyChanged(string? name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
