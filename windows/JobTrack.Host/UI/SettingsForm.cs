using System.Drawing;
using System.Text.Json;
using JobTrack.Host.Config;
using JobTrack.Host.Hosting;

namespace JobTrack.Host.UI;

/// <summary>
/// A typed editor for the settings that have to be decided before the server boots.
/// </summary>
/// <remarks>
/// It writes the same <c>%APPDATA%\jobtrack\.env</c> the npm package reads — never a second,
/// parallel config format — so an installation can be driven from here or from a text editor
/// without the two disagreeing. <see cref="EnvFile"/> does the preserving.
///
/// The web UI's own Settings page deliberately does not do this (its header says so): it switches
/// between already-configured database targets and handles backups. Everything here is the layer
/// underneath that, which the server reads exactly once at boot — which is why the footer says
/// changes need a restart rather than pretending otherwise. Autostart is the one genuine
/// exception, since it is a registry value this application owns.
/// </remarks>
internal sealed class SettingsForm : Form
{
    private static readonly string[] Drivers = ["sqlite", "postgres", "mysql"];

    private readonly NodeSupervisor _supervisor;
    private readonly LaunchManifest _manifest;
    private readonly HostSettings _hostSettings;
    private readonly EnvFile _env;

    private readonly ComboBox _host = new() { DropDownStyle = ComboBoxStyle.DropDown, Width = 180 };
    private readonly NumericUpDown _port = new() { Minimum = 1, Maximum = 65535, Width = 90 };
    private readonly CheckBox _autostart = new() { Text = "Start JobTrack when I sign in", AutoSize = true };
    private readonly CheckBox _openBrowser = new() { Text = "Open JobTrack in my browser when it starts", AutoSize = true };
    private readonly Label _hostWarning = new() { AutoSize = false, Height = 32, ForeColor = Color.FromArgb(150, 90, 0) };

    private readonly ComboBox _driver = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 140 };
    private readonly TextBox _dbFile = new() { Width = 340 };
    private readonly TextBox _databaseUrl = new() { Width = 340, UseSystemPasswordChar = true };
    private readonly CheckBox _showUrl = new() { Text = "Show", AutoSize = true };
    private readonly TextBox _dbTargets = new() { Width = 420, Multiline = true, Height = 90, ScrollBars = ScrollBars.Vertical };

    private readonly CheckBox _semantic = new() { Text = "Enable semantic search", AutoSize = true };
    private readonly TextBox _model = new() { Width = 300 };
    private readonly TextBox _modelCache = new() { Width = 300 };

    private readonly TextBox _token = new() { Width = 380, ReadOnly = true, UseSystemPasswordChar = true };
    private readonly TextBox _corsOrigins = new() { Width = 380, Multiline = true, Height = 80, ScrollBars = ScrollBars.Vertical };

    private readonly TextBox _raw = new()
    {
        Multiline = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill,
        Font = new Font("Consolas", 9f),
    };

    private readonly TabControl _tabs = new() { Dock = DockStyle.Fill };
    private FlowLayoutPanel _footerButtons = null!;
    private bool _rawIsAuthoritative;

    public SettingsForm(NodeSupervisor supervisor, LaunchManifest manifest, HostSettings hostSettings)
    {
        _supervisor = supervisor;
        _manifest = manifest;
        _hostSettings = hostSettings;
        _env = EnvFile.Load(Paths.EnvFile, manifest.EnvExample is { } example ? Paths.Resolve(example) : null);

        Text = "JobTrack Settings";
        Icon = Icons.App;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.Sizable;
        MaximizeBox = false;

        _tabs.TabPages.Add(BuildGeneralTab());
        _tabs.TabPages.Add(BuildDatabaseTab());
        _tabs.TabPages.Add(BuildSearchTab());
        _tabs.TabPages.Add(BuildAccessTab());
        _tabs.TabPages.Add(BuildAdvancedTab());
        _tabs.Selecting += OnTabSelecting;

        Controls.Add(_tabs);
        Controls.Add(BuildFooter());
        ApplySizeLimits();
        LoadValues();
    }

    // ------------------------------------------------------------------------------------ layout

    /// <summary>
    /// Sets the window's minimum and opening size from what its contents actually measure.
    /// </summary>
    /// <remarks>
    /// Two things here refuse to shrink: the footer buttons, which do not wrap, and the hint text,
    /// which wraps at a fixed width. A window narrower than either clips "Save and restart" off
    /// the right-hand edge or grows a horizontal scrollbar across the tab. Measuring rather than
    /// hard-coding a number keeps that true at 150% scaling and with a large system font, where
    /// the same three buttons are half again as wide as they are here.
    /// </remarks>
    private void ApplySizeLimits()
    {
        // The border and title bar, which the measurements below are all inside of.
        var chrome = Math.Max(Size.Width - ClientSize.Width, 16);
        // Enough of the footer left for the "Changes apply when JobTrack restarts." note to sit
        // on one line rather than wrapping into the three the old 560px minimum forced.
        const int NoteWidth = 260;
        var forFooter = _footerButtons.PreferredSize.Width + NoteWidth + chrome;
        // Tab body inset, page padding, and the vertical scrollbar a full page puts there.
        var forHints = HintWidth + 8 + 28 + SystemInformation.VerticalScrollBarWidth + chrome;

        MinimumSize = new Size(Math.Max(forFooter, forHints), 520);
        Size = new Size(Math.Max(MinimumSize.Width, 720), 620);
    }

    private static Label Caption(string text) => new() { Text = text, AutoSize = true, Margin = new Padding(3, 8, 3, 0) };

    /// <summary>The width hint text wraps at; <see cref="ApplySizeLimits"/> keeps room for it.</summary>
    private const int HintWidth = 580;

    private static Label Hint(string text) => new()
    {
        Text = text, AutoSize = true, ForeColor = SystemColors.GrayText, Margin = new Padding(3, 0, 3, 10),
        MaximumSize = new Size(HintWidth, 0),
    };

    private Button SmallButton(string text, EventHandler onClick, Glyph? glyph = null)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            // Standard rather than System: a System-styled button is drawn by the OS and ignores
            // the Image property, so the glyph would silently not appear.
            FlatStyle = FlatStyle.Standard,
            Padding = new Padding(glyph is null ? 10 : 8, 5, 10, 5),
            Margin = new Padding(0, 0, 8, 0),
        };
        if (glyph is { } icon)
        {
            button.Image = Glyphs.Button(icon, DeviceDpi);
            button.ImageAlign = ContentAlignment.MiddleLeft;
            button.TextAlign = ContentAlignment.MiddleRight;
            button.TextImageRelation = TextImageRelation.ImageBeforeText;
        }
        button.Click += onClick;
        return button;
    }

    private static FlowLayoutPanel Row(params Control[] controls)
    {
        var row = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0) };
        row.Controls.AddRange(controls);
        return row;
    }

    private static TabPage Page(string title, params Control[] controls)
    {
        var layout = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false,
            AutoScroll = true, Padding = new Padding(14, 12, 14, 12),
        };
        layout.Controls.AddRange(controls);
        var page = new TabPage(title) { UseVisualStyleBackColor = true };
        page.Controls.Add(layout);
        return page;
    }

    private TabPage BuildGeneralTab()
    {
        _host.Items.AddRange(["127.0.0.1", "0.0.0.0"]);
        _host.TextChanged += (_, _) => UpdateHostWarning();
        _autostart.CheckedChanged += (_, _) => Autostart.Set(_autostart.Checked);

        return Page("General",
            Caption("Address"),
            Row(_host, new Label { Text = "Port", AutoSize = true, Margin = new Padding(14, 6, 4, 0) }, _port),
            Hint("127.0.0.1 keeps JobTrack reachable only from this machine. Leave it unless you know you want otherwise."),
            _hostWarning,
            _autostart,
            Hint("Applies immediately — it is a Windows setting, not part of the JobTrack configuration."),
            _openBrowser);
    }

    private TabPage BuildDatabaseTab()
    {
        _driver.Items.AddRange([.. Drivers.Cast<object>()]);
        _driver.SelectedIndexChanged += (_, _) => UpdateDriverFields();
        _showUrl.CheckedChanged += (_, _) => _databaseUrl.UseSystemPasswordChar = !_showUrl.Checked;

        return Page("Database",
            Caption("Driver"),
            _driver,
            Caption("SQLite file"),
            Row(_dbFile, SmallButton("Browse...", BrowseForDatabase, Glyphs.Folder)),
            Hint("A bare file name goes in the data folder; a relative path is resolved from it; an absolute path is used as written."),
            Caption("Connection URL"),
            Row(_databaseUrl, _showUrl),
            Hint("Required for postgres and mysql."),
            Caption("Additional named targets (DB_TARGETS)"),
            _dbTargets,
            Hint("A JSON array of {name, driver, file|url}. Once configured, switch between them from the web UI's Settings page."));
    }

    private TabPage BuildSearchTab() => Page("Search",
        _semantic,
        Hint("Off means lexical search only. Left on, JobTrack downloads a small embedding model the first time it is needed and falls back to lexical if that fails."),
        Caption("Embedding model"),
        _model,
        Caption("Model cache folder"),
        Row(_modelCache, SmallButton("Open", (_, _) => Shell.OpenFolder(ResolveAgainstHome(_modelCache.Text, ".models")), Glyphs.Folder)));

    private TabPage BuildAccessTab() => Page("Access",
        Caption("API token"),
        Row(_token,
            SmallButton("Copy", (_, _) => CopyToken(), Glyphs.Copy),
            SmallButton("Show", (_, _) => _token.UseSystemPasswordChar = !_token.UseSystemPasswordChar, Glyphs.Eye)),
        Hint("Paste this into the JobTrack Clipper extension's options page."),
        Row(SmallButton("Regenerate token...", (_, _) => RegenerateToken(), Glyphs.Refresh)),
        Hint("Invalidates the current token; every browser extension using it has to be updated."),
        Caption("Extra allowed browser origins"),
        _corsOrigins,
        Hint("One per line. JobTrack's own address is always allowed, and the extension uses the token instead."));

    private TabPage BuildAdvancedTab()
    {
        var page = new TabPage("Advanced") { UseVisualStyleBackColor = true };
        var toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 36, Padding = new Padding(6, 6, 6, 0) };
        toolbar.Controls.Add(SmallButton("Open .env in Notepad", (_, _) => Shell.OpenInEditor(Paths.EnvFile), Glyphs.Document));
        toolbar.Controls.Add(SmallButton("Open data folder", (_, _) => Shell.OpenFolder(Paths.JobtrackHome), Glyphs.Folder));
        page.Controls.Add(_raw);
        page.Controls.Add(toolbar);
        return page;
    }

    private Control BuildFooter()
    {
        var saveAndRestart = SmallButton("Save and restart", async (_, _) => await SaveAsync(restart: true), Glyphs.Refresh);
        var save = SmallButton("Save", async (_, _) => await SaveAsync(restart: false), Glyphs.Save);
        var cancel = SmallButton("Cancel", (_, _) => Close(), Glyphs.Cancel);
        AcceptButton = saveAndRestart;
        CancelButton = cancel;

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Right,
            FlowDirection = FlowDirection.RightToLeft,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            // Without this the three buttons wrap onto rows the footer is not tall enough to show,
            // and Save and Cancel simply vanish off the bottom edge.
            WrapContents = false,
            Padding = new Padding(0, 12, 12, 12),
        };
        buttons.Controls.AddRange([saveAndRestart, save, cancel]);
        _footerButtons = buttons;

        var note = new Label
        {
            // Honest rather than reassuring: apps/api/src/config.ts reads every one of these once,
            // at boot. Nothing here takes effect live except the autostart checkbox.
            Text = "Changes apply when JobTrack restarts.",
            Dock = DockStyle.Fill,
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleLeft,
            ForeColor = SystemColors.GrayText,
            Padding = new Padding(14, 0, 8, 0),
            AutoEllipsis = true,
        };

        var footer = new Panel { Dock = DockStyle.Bottom, Height = 62 };
        // A hairline above the buttons, so the footer reads as a separate band from the tab
        // content rather than floating loose under it.
        footer.Paint += (_, e) => e.Graphics.DrawLine(SystemPens.ControlLight, 0, 0, footer.Width, 0);
        // Order matters: docking is applied from the end of the collection backwards, so the
        // buttons must be added last to claim the right-hand side before the note fills the rest.
        footer.Controls.Add(note);
        footer.Controls.Add(buttons);
        return footer;
    }

    // ------------------------------------------------------------------------------------- state

    private void LoadValues()
    {
        _host.Text = _env.GetOrDefault("HOST", "127.0.0.1");
        _port.Value = int.TryParse(_env.Get("PORT"), out var port) && port is >= 1 and <= 65535 ? port : 3001;
        _autostart.Checked = Autostart.IsEnabled;
        _openBrowser.Checked = _hostSettings.OpenBrowserOnStart;

        _driver.SelectedItem = Drivers.Contains(_env.GetOrDefault("DB_DRIVER", "sqlite")) ? _env.GetOrDefault("DB_DRIVER", "sqlite") : "sqlite";
        _dbFile.Text = _env.Get("DB_FILE") ?? string.Empty;
        _databaseUrl.Text = _env.Get("DATABASE_URL") ?? string.Empty;
        _dbTargets.Text = _env.Get("DB_TARGETS") ?? string.Empty;

        _semantic.Checked = _env.GetBool("SEMANTIC_SEARCH", true);
        _model.Text = _env.Get("EMBEDDING_MODEL") ?? string.Empty;
        _model.PlaceholderText = "Xenova/all-MiniLM-L6-v2";
        _modelCache.Text = _env.Get("MODEL_CACHE_DIR") ?? string.Empty;
        _modelCache.PlaceholderText = ".models";
        _dbFile.PlaceholderText = "data/jobtrack.db";

        _token.Text = ApiToken.Read(_env) ?? "(generated when the server first starts)";
        _corsOrigins.Text = string.Join(Environment.NewLine,
            (_env.Get("CORS_ORIGINS") ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));

        _raw.Text = _env.Render();
        UpdateDriverFields();
        UpdateHostWarning();
    }

    private void UpdateDriverFields()
    {
        var sqlite = (_driver.SelectedItem as string ?? "sqlite") == "sqlite";
        _dbFile.Enabled = sqlite;
        _databaseUrl.Enabled = !sqlite;
        _showUrl.Enabled = !sqlite;
    }

    private void UpdateHostWarning() =>
        _hostWarning.Text = _host.Text.Trim() == "0.0.0.0"
            ? "0.0.0.0 exposes JobTrack to your whole network. Anything that can reach this machine can reach your applications."
            : string.Empty;

    /// <summary>
    /// Leaving the Advanced tab hands authority back to the typed controls, and entering it takes
    /// authority away from them — otherwise a hand-edit and a control edit would silently race.
    /// </summary>
    private void OnTabSelecting(object? sender, TabControlCancelEventArgs e)
    {
        if (e.TabPage?.Text == "Advanced")
        {
            ApplyTypedValues();
            _raw.Text = _env.Render();
            _rawIsAuthoritative = true;
        }
        else if (_rawIsAuthoritative)
        {
            AdoptRawText();
            _rawIsAuthoritative = false;
        }
    }

    private void AdoptRawText()
    {
        var reparsed = EnvFile.Parse(_raw.Text);
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
        _env.SetOrUnset("HOST", _host.Text.Trim());
        _env.Set("PORT", ((int)_port.Value).ToString());
        _env.SetOrUnset("DB_DRIVER", _driver.SelectedItem as string);
        _env.SetOrUnset("DB_FILE", _dbFile.Text);
        _env.SetOrUnset("DATABASE_URL", _databaseUrl.Text);
        _env.SetOrUnset("DB_TARGETS", _dbTargets.Text.Trim());
        // The server treats only the literal string "false" as off, so writing the word out is
        // both correct and readable in the file.
        _env.Set("SEMANTIC_SEARCH", _semantic.Checked ? "true" : "false");
        _env.SetOrUnset("EMBEDDING_MODEL", _model.Text);
        _env.SetOrUnset("MODEL_CACHE_DIR", _modelCache.Text);
        _env.SetOrUnset("CORS_ORIGINS", string.Join(',',
            _corsOrigins.Lines.Select(line => line.Trim()).Where(line => line.Length > 0)));
    }

    // -------------------------------------------------------------------------------- validation

    private bool Validate(out string problem)
    {
        problem = string.Empty;
        var driver = _driver.SelectedItem as string ?? "sqlite";

        if (driver != "sqlite" && _databaseUrl.Text.Trim().Length == 0)
        {
            problem = $"The {driver} driver needs a connection URL.";
            return false;
        }

        var targets = _dbTargets.Text.Trim();
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

    // ------------------------------------------------------------------------------------ actions

    private async Task SaveAsync(bool restart)
    {
        if (_rawIsAuthoritative) AdoptRawText();
        else ApplyTypedValues();

        if (!Validate(out var problem))
        {
            MessageBox.Show(problem, "JobTrack Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        try
        {
            _env.Save(Paths.EnvFile);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            MessageBox.Show($"Could not save {Paths.EnvFile}.\n\n{error.Message}",
                "JobTrack Settings", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        _hostSettings.OpenBrowserOnStart = _openBrowser.Checked;
        _hostSettings.Save();

        Close();
        if (restart) await _supervisor.RestartAsync();
    }

    private void BrowseForDatabase(object? sender, EventArgs e)
    {
        using var dialog = new SaveFileDialog
        {
            Title = "JobTrack database",
            Filter = "SQLite database (*.db)|*.db|All files (*.*)|*.*",
            FileName = "jobtrack.db",
            InitialDirectory = Paths.DataDir,
            OverwritePrompt = false, // Picking an existing database is the normal case, not a mistake.
        };
        if (dialog.ShowDialog(this) == DialogResult.OK) _dbFile.Text = dialog.FileName;
    }

    private void CopyToken()
    {
        var token = ApiToken.Read(_env);
        if (token is not null && Shell.TrySetClipboard(token))
        {
            MessageBox.Show("The API token is on the clipboard.", "JobTrack Settings",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private void RegenerateToken()
    {
        if (_env.Get("API_TOKEN") is { Length: > 0 })
        {
            MessageBox.Show(
                "API_TOKEN is set in .env, so JobTrack is using the token you configured. Change it on the Advanced tab.",
                "JobTrack Settings", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        var confirmed = MessageBox.Show(
            "Generate a new API token?\n\nAny browser extension using the current token will stop working until you paste in the new one.",
            "JobTrack Settings", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
        if (confirmed != DialogResult.Yes) return;

        ApiToken.Regenerate();
        _token.Text = "(generated when the server next starts)";
    }

    private static string ResolveAgainstHome(string configured, string fallback)
    {
        var value = string.IsNullOrWhiteSpace(configured) ? fallback : configured.Trim();
        return Path.IsPathRooted(value) ? value : Path.Combine(Paths.JobtrackHome, value);
    }
}
