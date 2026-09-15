# The Windows app layer

Everything needed to ship JobTrack as a normal Windows application: a native tray host, a settings
dialog, and a per-user installer that carries its own Node runtime.

## Why this exists

`npm install -g jobtrack` works, and it stays the cross-platform and developer route. But on
Windows it asks for things a normal user does not have and produces a result nobody would call
finished:

| | Before | After |
| --- | --- | --- |
| Install | `npm install -g jobtrack`, needs Node 24+ and npm | One `.exe`, no prerequisites, no admin rights |
| Sign-in launch | A console window with `node` in it | Nothing visible but a tray icon |
| Processes | Two `node.exe`; killing one orphans the other | One `node.exe`, in a job object that cannot outlive the host |
| Second launch | Unhandled `EADDRINUSE` | Opens the running instance |
| A crash, or a database switch | Stays down — nothing supervises it | Restarted, with backoff and a log |
| Settings | Notepad on `.env` | A typed dialog that writes the same `.env` |
| Extension token | Copy it out of `data/api-token` by hand | Copy button (and from JobTrack 1.3.0 the extension connects without it) |
| Uninstall | `npm uninstall -g` | Add/Remove Programs, and it asks before deleting your database |

The important constraint: **the installer is a repackaging of the published npm release, never a
fork of it.** The payload is `npm install jobtrack@<version>` from the registry, and the settings
dialog edits the very same `%APPDATA%\jobtrack\.env` the npm package reads. The two channels cannot
drift, and both use the same data directory, so switching between them keeps your applications.

## Layout

```
windows/
  JobTrack.Host/          the .NET 10 WPF tray host (see below)
  installer/JobTrack.iss  Inno Setup script, per-user, no UAC
  scripts/
    build-payload.mjs     assembles node.exe + a pruned node_modules
    prune.json            what gets stripped, as reviewable data
    smoke-test.mjs        launches the payload and proves it works
  node-version.txt        the pinned Node runtime version
```

`windows/` sits outside `apps/` deliberately: the root `package.json` globs `workspaces:
["apps/*"]`, and `scripts/check-publishable.mjs` iterates a fixed package list, so nothing here can
affect npm publishing.

## The host

`JobTrack.exe` is a `WinExe` — a GUI-subsystem binary, which is the actual fix for the console
window at sign-in. It starts one `node.exe` with `CreateNoWindow`, reads the `JOBTRACK_READY` line
off its stdout to learn the URL, and asks it to stop by writing `quit` to stdin.

Two pieces are worth knowing about:

- **`Hosting/JobObject.cs`.** `node.exe` is assigned to a job object created with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. When the host goes away for any reason — quit, crash, End
  Task — the kernel closes the handle and the server dies with it. The graceful `quit` is tried
  first so SQLite closes properly; this is the guarantee underneath it.
- **`Config/EnvFile.cs`.** The settings dialog writes a file the user is expected to read.
  `.env` is seeded from `.env.example`, which is eleven commented-out keys with documentation above
  each, so setting a key *uncomments the existing line in place* rather than appending a bare
  `KEY=value` at the bottom. Comments, ordering, blank lines and line endings all survive.

The windows and the tray menu are WPF with [WPF-UI](https://github.com/lepoco/wpfui), laid out
the way PowerToys lays out its settings: a navigation pane, pages of setting cards, Mica on
Windows 11, and light or dark following the Windows setting. Every icon comes from the Fluent UI
System Icons font WPF-UI bundles, so the set is uniform and there are no image assets to maintain.
The tray icon is [H.NotifyIcon](https://github.com/HavenDV/H.NotifyIcon), which shows a real WPF
context menu, so the menu is styled like the windows. Both libraries are MIT.

The host also polls `GET /api/agenda` every half hour (`Hosting/ReminderPoller.cs`) and shows a
balloon when a follow-up or a person's reconnect date comes due, once per item and due date.
Clicking it opens the dashboard. It is a host preference (`remindersEnabled` in `host.json`,
on by default), toggled under General in the settings dialog, and it applies without a restart.

### Claude Desktop

The payload bundles the MCP server, and the host keeps Claude Desktop pointed at it
(`Config/ClaudeDesktop.cs`). On every start it writes a `jobtrack` entry into
`claude_desktop_config.json` that runs the bundled `node.exe` on the bundled
`@jobtrack/mcp`, with `JOBTRACK_HOME` set so it shares the tray's database. The paths carry no
version, so the entry itself rarely changes; what changes is the server behind it, which moves
with every installer. That is the point: a global `npm install -g @jobtrack/mcp` is never
updated by upgrading the tray, and Claude Desktop would otherwise keep running whatever was
installed first.

The edit is careful with a file that belongs to another application:

- Everything else in the file is kept, including other servers, Claude's own preferences, and any
  variable the user added to the entry's `env`.
- The file is only written when the entry changes, via a temporary file moved into place, and
  never when it does not parse.
- Only an installed Claude Desktop gets an entry: `%APPDATA%\Claude` for the classic install, and
  the package's `LocalCache\Roaming\Claude` for the MSIX one. No directory, no file.

When the entry changes, or an upgrade brings a new server version, a balloon says to restart
Claude Desktop, since it only reads its config at launch. The installer stops any MCP server
Claude Desktop started from `{app}\node\node.exe` before replacing files, because a running one
locks `node.exe`, and the uninstaller runs `JobTrack.exe --disconnect-claude-desktop`, which
removes the entry only where it runs this installation.

It is a host preference (`connectClaudeDesktop` in `host.json`, on by default), under General in
the settings dialog. Turning it off removes the entry. **Copy MCP client config** in the tray menu
gives the same entry to any other MCP client.

Everything else in the dialog is read by the server once, at boot (`apps/api/src/config.ts`), so the
footer says changes need a restart instead of pretending they are live. Autostart and the update
check are the exceptions: they belong to this application, not to the server.

### Updates

`Updates/UpdateService.cs` asks GitHub for the latest release
(`api.github.com/repos/CuplexUser/JobTrack/releases/latest`, which never returns drafts or
prereleases) two minutes after start and every twelve hours after that. A release is only offered
once `windows-release.yml` has attached both `JobTrack-Setup-<version>.exe` and its `.sha256`. An
available update shows a notification and an **Install update** item in the tray menu, and the
Updates page in Settings has the same state, a manual check, and the switch that turns automatic
checks off (`checkForUpdates` in `host.json`, on by default). Nothing is installed without a click.

Installing (`Updates/UpdateInstaller.cs`):

1. The installer downloads to `%LOCALAPPDATA%\JobTrack\updates`, which the uninstaller already removes.
2. Its SHA-256 has to match the published `.sha256`, or the file is deleted and nothing runs.
3. When the running `JobTrack.exe` is Authenticode-signed, the installer has to be validly signed by
   the same subject. Unsigned builds skip this, since they have no publisher to compare against.
4. It runs with `/SILENT /SUPPRESSMSGBOXES /NORESTART /relaunch=1` and the host quits, shutting the
   server down cleanly. `PrepareToInstall` stops anything left over, as for any upgrade, and
   `/relaunch=1` makes the installer start `JobTrack.exe --updated` when it is done, which shows an
   "updated" notification instead of opening the browser.

To try the whole flow before a release exists, point `JOBTRACK_UPDATE_FEED` at any URL that answers
in the shape of the GitHub API: a JSON file with `tag_name`, `html_url` and `assets` entries whose
`browser_download_url`s point at a locally built installer and its `.sha256`, served from a local
HTTP server. The host logs when the override is in use.

## Building it

`windows/build.ps1` runs all three steps below and prints the installer's path, size and SHA-256.
It asks where the payload should come from, or takes `-Source`:

```powershell
# Asks: Registry (pinned node.exe + the latest jobtrack and @jobtrack/mcp from npm) or Local
./windows/build.ps1

# A published release, as CI builds it
./windows/build.ps1 -Source Registry -Version 1.6.0

# This checkout, before it is published (build-payload.mjs --local --with-mcp)
./windows/build.ps1 -Source Local
```

It finds `ISCC.exe` through `$env:ISCC`, Inno Setup's uninstall registration, or the per-user and
machine-wide install folders, so a winget install under `%LOCALAPPDATA%\Programs` works as well as
a machine-wide one. `-SkipSmoke`, `-NodeExe` and `-KeepDml` pass through to `build-payload.mjs`.

The same steps by hand:

```powershell
# The payload: pinned node.exe + jobtrack from the registry, pruned, then launched and tested
node windows/scripts/build-payload.mjs --version 1.3.0 --with-mcp

# The host, self-contained, into the same payload tree
dotnet publish windows/JobTrack.Host/JobTrack.Host.csproj -c Release -r win-x64 `
  --self-contained true -o windows/installer/payload/host

# The installer
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" /DAppVersion=1.3.0 windows\installer\JobTrack.iss

# The installer (from local user install/winget)
& "${env:LOCALAPPDATA}\programs\Inno Setup 6\ISCC.exe" /DAppVersion=1.3.0 windows\installer\JobTrack.iss
```

To test a change before publishing it, `--local` packs this checkout with `npm pack` instead of
pulling from the registry — the verification `docs/publishing.md` describes, carried through to a
real installer:

```powershell
node windows/scripts/build-payload.mjs --local --with-mcp
```

Other flags: `--node-exe <path>` reuses an installed `node.exe` instead of downloading the pinned
one, `--keep-dml` keeps the DirectML execution provider, and `--skip-smoke` skips the launch test.

## The prune, and why the smoke test is not optional

A stock install is about 480 MB, mostly binaries for platforms this will never run on.
`scripts/prune.json` takes it to 96 MB — a measured 479.8 MB down to 96.2 MB, 80% reclaimed. Two entries are **gut-the-directory, not
delete-the-package**: `onnxruntime-web` and `sharp` are *statically* imported by
`@huggingface/transformers/dist/transformers.node.mjs`, so deleting either breaks module resolution
even though neither does any work on the CPU path. For `onnxruntime-web`, Node's export map
resolves `./webgpu` to one 113 KB file out of a 125 MB `dist/`; that file stays and the rest goes.

`systray` (35 MB of Go tray binaries for three platforms) can only be dropped because
`apps/tray/src/cli.ts` imports `./tray.js` dynamically — the host draws its own tray and always
passes `--no-tray`.

The smoke test is what makes any of this safe. `TransformersEmbedder` downgrades a failed model
load to a warning and carries on lexical-only, so a bad ONNX prune would ship as *"semantic search
quietly stopped working"* rather than as a crash. `smoke-test.mjs` therefore starts the payload,
serves the UI, creates a record, and waits for `semanticReady` to actually come back true before the
build is allowed to pass.

## Releasing

`.github/workflows/windows-release.yml` runs after **Publish to npm** succeeds, and is safe to fire
on every push: it stops cleanly when the version in `apps/tray/package.json` is not on the registry
(the push bumped nothing), and again when that version already has an installer attached. So the
release gesture is unchanged — bump `apps/tray/package.json`, push — and the installer version is
the npm version by construction.

Code signing is wired in but gated on `vars.AZURE_TENANT_ID` being set, so the pipeline works
unsigned until Azure Trusted Signing is configured. Until then the release notes tell people about
the SmartScreen prompt.

## Known gaps

- **x64 only.** ARM64 machines run it under emulation. `onnxruntime-node` ships `win32/arm64`
  binaries, so a native payload is a matter of a second build, not a redesign.
- **The embedding model is not bundled.** It downloads on first use, as it does on the npm path.
  A first run with no network gets lexical search.
- **The icon tops out at 48px.** `apps/web/public/favicon.ico` carries 16/20/32/48 only, so the
  installer wizard and Explorer's large-icon view upscale it. The fix belongs in
  `apps/web/scripts/make-icons.mjs`, which should emit a 256px frame too.
- **Cold start is slow.** Measured on the 1.3.0 payload: **31 s** on a completely cold tsx cache,
  **3 s** warm. tsx shells out to `esbuild.exe` to transpile the TypeScript sources, and the first
  run has nothing cached. The tray icon appears immediately in a "starting" state so it is visible
  rather than mysterious, but 31 seconds is too long for a first impression. Running esbuild at
  payload-build time instead — bundling `cli.ts` and `@jobtrack/api` into one `server.mjs` with the
  native packages left external — would remove it entirely and drop another 12 MB with `tsx` and
  `@esbuild`. The cost is the "just a repackaging of the npm release" property, which is why it is
  not v1, but it is the single biggest improvement left.
