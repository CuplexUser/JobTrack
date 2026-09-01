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
| Extension token | Copy it out of `data/api-token` by hand | Copy button |
| Uninstall | `npm uninstall -g` | Add/Remove Programs, and it asks before deleting your database |

The important constraint: **the installer is a repackaging of the published npm release, never a
fork of it.** The payload is `npm install jobtrack@<version>` from the registry, and the settings
dialog edits the very same `%APPDATA%\jobtrack\.env` the npm package reads. The two channels cannot
drift, and both use the same data directory, so switching between them keeps your applications.

## Layout

```
windows/
  JobTrack.Host/          the .NET 10 WinForms tray host (see below)
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

Everything in the dialog is read by the server once, at boot (`apps/api/src/config.ts`), so the
footer says changes need a restart instead of pretending they are live. Autostart is the exception:
it is a registry value this application owns.

## Building it

```powershell
# The payload: pinned node.exe + jobtrack from the registry, pruned, then launched and tested
node windows/scripts/build-payload.mjs --version 1.0.11 --with-mcp

# The host, self-contained, into the same payload tree
dotnet publish windows/JobTrack.Host/JobTrack.Host.csproj -c Release -r win-x64 `
  --self-contained true -o windows/installer/payload/host

# The installer
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" /DAppVersion=1.0.11 windows\installer\JobTrack.iss
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
- **No in-app updates.** The intended v1 addition is a "check for updates" item that compares
  against the registry and opens the Releases page.
- **The icon tops out at 48px.** `apps/web/public/favicon.ico` carries 16/20/32/48 only, so the
  installer wizard and Explorer's large-icon view upscale it. The fix belongs in
  `apps/web/scripts/make-icons.mjs`, which should emit a 256px frame too.
- **Cold start is slow.** Measured on the 1.0.11 payload: **31 s** on a completely cold tsx cache,
  **3 s** warm. tsx shells out to `esbuild.exe` to transpile the TypeScript sources, and the first
  run has nothing cached. The tray icon appears immediately in a "starting" state so it is visible
  rather than mysterious, but 31 seconds is too long for a first impression. Running esbuild at
  payload-build time instead — bundling `cli.ts` and `@jobtrack/api` into one `server.mjs` with the
  native packages left external — would remove it entirely and drop another 12 MB with `tsx` and
  `@esbuild`. The cost is the "just a repackaging of the npm release" property, which is why it is
  not v1, but it is the single biggest improvement left.
