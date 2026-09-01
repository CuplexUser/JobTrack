# Publishing to npm

`apps/tray` (package name `jobtrack`) and `apps/mcp` (`@jobtrack/mcp`) are both set up to be
published standalone, not just run from a clone of this repo — `npm install -g jobtrack` gets
you the full API + web UI + tray icon, and `npm install -g @jobtrack/mcp` gets you an MCP
server, neither needing a monorepo in sight. Releases go out from GitHub Actions — see
[Publishing from GitHub Actions](#publishing-from-github-actions) below, or
[Publishing by hand](#publishing-by-hand) for the `publish-all.ps1` route it replaced.

## How it's wired for this

- `@jobtrack/api` and `@jobtrack/shared` are real (non-private) packages with proper `^x.y.z`
  dependencies between them — neither `jobtrack` nor `@jobtrack/mcp` relies on the
  workspace-only `*` protocol for either, so installing them can resolve their dependencies
  from the registry once those are published there too.
- `apps/tray/scripts/stage-assets.mjs` runs automatically as a `prepack` step (`npm pack` /
  `npm publish`): it builds the web UI and copies it, plus `.env.example`, into
  `apps/tray/vendor/` (gitignored — regenerated, never hand-edited), which the package's
  `files` list includes. `src/assets.ts` prefers that bundled copy at runtime and only falls
  back to the sibling `apps/web/dist`/root `.env.example` for local development. `apps/mcp`
  has no such step — it doesn't serve the web UI, so there's nothing to vendor.
- There's no monorepo once either runs from `node_modules`, so `apps/api/src/config.ts`'s
  `resolveAppDataDir()` points the database, model cache, and active-DB-target pointer at
  `JOBTRACK_HOME` instead of the repo root when that env var is set. Both packages' bin
  scripts (`apps/tray/bin/jobtrack.js`, `apps/mcp/bin/jobtrack-mcp.js`) — as opposed to
  `npm run tray`'s `tsx src/cli.ts` / `npm run mcp`'s `tsx src/index.ts` — set the *same*
  sensible per-user default (`%APPDATA%\jobtrack` on Windows, `~/.local/share/jobtrack`
  elsewhere) whenever it isn't already set, so installing both means they share one database
  with zero extra configuration.

## Verifying before you publish

`npm pack` in `packages/shared`, `apps/api`, `apps/mcp`, and `apps/tray` (in that order), then
`npm install` the four `.tgz` files as dependencies in a scratch project outside this repo —
that's a true standalone install, not a workspace symlink.

## Publishing from GitHub Actions

This is the way to publish. `.github/workflows/publish.yml` runs the same four `npm publish`
calls from a clean checkout, authenticated by npm trusted publishing (OIDC) rather than a
stored token, with `--provenance` so each tarball carries a signed attestation binding it to
the workflow run and commit that produced it — npm shows that as a "Built and signed on
GitHub Actions" link back to the source.

It runs on **every push to `main`**, and publishes for real. That needs no confirmation step
because the gate below is the confirmation: a push whose versions are all on the registry
publishes nothing at all, so bumping a version in `package.json` *is* the release, and a push
that changed a package without bumping it fails rather than shipping. Nothing is published
until the same typecheck and test suite CI runs has passed on a clean checkout.

You can also run it by hand from **Actions → Publish to npm → Run workflow**, where it
defaults to a dry run — every gate and `npm pack`, nothing sent to the registry — which is
how to see what a release would do before committing the bump. Add required reviewers by
putting the `publish` job in a GitHub environment if you want a second pair of eyes on the
push path; note the environment name then has to be added to all four trusted publisher
configurations on npmjs.com, or authentication fails.

### One-time setup: a trusted publisher per package

Trusted publishing is configured **per package on npmjs.com**, not in this repo, and all four
need it. For each of `@jobtrack/shared`, `@jobtrack/api`, `@jobtrack/mcp` and `jobtrack`, go
to the package's **Settings → Trusted Publisher**, choose GitHub Actions, and fill in:

| Field | Value |
| --- | --- |
| Organization or user | `CuplexUser` |
| Repository | `JobTrack` |
| Workflow filename | `publish.yml` |
| Environment | *(leave blank unless you added one)* |

Two things to know. The workflow **filename** is part of the trust rule, so renaming
`publish.yml` breaks publishing until all four configurations are updated — and the workflow
can't call a reusable workflow to publish, because npm validates the calling workflow's name.
And trusted publishing only works on GitHub-hosted runners; a self-hosted runner can't
produce a token npm will accept.

Both trusted publishing and provenance require the repo and the packages to be public.

### The gates

`scripts/check-publishable.mjs` runs before anything is published and decides, per package:
publish it (the version isn't on the registry), skip it (the version is there and its tarball
matches this checkout), or **fail the build** (the version is there but the contents differ —
someone changed the sources without bumping the version).

That last case is the one worth having. It's the failure that shipped `@jobtrack/api`'s
post-refactor sources under an already-published version number, leaving npm serving the old
tarball while the installed CLI failed on an import that didn't exist yet. `publish-all.ps1`
skips that package silently; CI stops with a list of the differing files.

Run it locally any time — it only reads from the registry:

```powershell
npm run build --workspace=@jobtrack/shared   # it ships dist/, which `npm pack` won't build
node scripts/check-publishable.mjs
```

It compares the published tarball against a freshly packed one rather than comparing version
numbers, so it sees drift a version check can't. Line endings are normalized before hashing:
this repo is developed on Windows with `core.autocrlf=true`, so tarballs packed there carry
CRLF where a Linux CI checkout has LF, and without that every text file in every package
would read as changed.

`apps/tray`'s `vendor/` is the one tree left out of that comparison. It's a build artifact
rebuilt on every pack, so diffing it would test whether the build is byte-reproducible across
machines rather than whether anyone edited the sources. But leaving it unchecked is what let
`jobtrack@1.0.6` ship a web UI two commits stale, so it's gated a different way: the tray
declares the sources it bundles but doesn't own (`apps/web`, the root `.env.example`) and the
check asks git whether any of them changed *after the commit that set the current version*.
If they did, the build fails until the tray is bumped. That's why the workflow checks out
with `fetch-depth: 0` — the default shallow clone has no history to ask.

Differences under `vendor/` are still printed when they show up, as a note rather than a
failure.

## The Windows release channel

The Windows installer is a **repackaging of what was just published**, not a separate build. Once
`publish.yml` succeeds, `.github/workflows/windows-release.yml` installs `jobtrack@<version>` from
the registry into a clean prefix, prunes it to win32-x64, adds a pinned `node.exe` and the .NET
tray host, and attaches `JobTrack-Setup-<version>.exe` to a GitHub Release. See
[`windows/README.md`](../windows/README.md).

Three things follow from that, and they are the reason it is wired this way:

- **The release gesture is unchanged.** Bump `apps/tray/package.json`, push. The installer version
  is the npm version by construction — there is no tag to remember and no second number to keep in
  step.
- **It is safe to fire on every publish run.** The great majority publish nothing, and the payload
  build stops cleanly when the version is not on the registry. A version that already has an
  installer attached is skipped too, so re-running is free.
- **It cannot ship something npm did not.** The payload comes from the published tarball, so an
  installer for a version that was never published simply cannot be built.

To check a change before publishing it, `--local` packs this checkout with `npm pack` instead —
the same verification described above, carried all the way through to a real installer:

```powershell
node windows/scripts/build-payload.mjs --local --with-mcp
```

Nothing under `windows/` affects `scripts/check-publishable.mjs`: it iterates a fixed package list
(`packages/shared`, `apps/api`, `apps/mcp`, `apps/tray`) and `windows/` is outside all four and
outside every `files` list. The two traps named above still apply, though — editing
`apps/tray/README.md` or `.env.example` needs a `jobtrack` version bump in the same commit range.

## Publishing by hand

`publish-all.ps1`, at the repo root, still works and is handy for a local dry run — but it
authenticates as you rather than as the workflow, so nothing it publishes gets provenance,
and it skips an already-published version instead of checking whether its contents changed.

It does the four `npm publish` calls below in order for you — it prints each package's
`name@version`, refuses to run if `npm whoami` shows you're not logged in, asks for a typed
`yes` before touching the registry (since a published version can never be overwritten), and
stops immediately if any step fails rather than continuing on to a package whose dependency
didn't actually publish:

```powershell
npm login   # once, if not already
.\publish-all.ps1
```

Pass `-DryRun` to run `npm pack --dry-run` for all four instead — lists what each tarball
would contain without publishing anything, and skips the confirmation prompt.

Equivalent by hand (e.g. on macOS/Linux, where the script doesn't apply):

```bash
npm login   # once, if not already

cd packages/shared && npm publish --access public
cd ../../apps/api  && npm publish --access public
cd ../mcp          && npm publish --access public
cd ../tray         && npm publish --access public   # runs prepack -> stage-assets.mjs
```

Order matters either way: `apps/api` depends on `@jobtrack/shared`; `apps/mcp` and
`apps/tray` both depend on `@jobtrack/api`.

Notes from doing this the first time:

- **`--access public` is required**, not optional, for the two scoped packages
  (`@jobtrack/shared`, `@jobtrack/api`) — npm defaults scoped packages to private/paid
  otherwise. `jobtrack` itself is unscoped and public by default, but passing the flag
  everywhere is harmless.
- **A brand-new scope 404s on first publish.** `npm publish` for `@jobtrack/shared` failed
  with `404 Scope not found` until the `jobtrack` org was created at
  <https://www.npmjs.com/org/create> — npm doesn't auto-create a scope the way it does an
  unscoped package name. Do this once, before the first scoped publish.
- **Each package needs its own `README.md`** sitting in its own directory (not just the repo
  root) — npm renders whatever `README.md` is in the published tarball's root, and a missing
  one means a blank npm page. `packages/shared`, `apps/api`, `apps/mcp`, and `apps/tray` each
  carry one.
- **Same for `LICENSE` and the `license` field.** A root-level `LICENSE` file doesn't reach
  a package's tarball on its own, and without a `license` field in that package's
  `package.json`, its npm page shows "License: none" even though the project is MIT. Each of
  the four packages carries its own copy of `LICENSE` (in its `files` list) plus
  `"license": "MIT"`.
- **Versions are immutable.** Once `1.0.0` is published, you can't overwrite it — fixing
  anything metadata-only (a typo'd README, a missing `repository` field) still means bumping
  the version and republishing, even though nothing code-level changed.
