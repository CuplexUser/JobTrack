# Roadmap

A living list of directions for JobTrack — not commitments or dates, just the
things worth doing next in rough priority order.

## 1. Background tray app via npm global install — ✅ published

`apps/tray` (package name `jobtrack`) runs the API and the built web UI as one
process, with a Windows tray icon (open UI / toggle autostart / open settings /
quit) — see the README's [Tray app](README.md#tray-app) section. All four packages
— `@jobtrack/shared`, `@jobtrack/api`, `@jobtrack/mcp` and `jobtrack` — are live on
the npm registry now (see [`docs/publishing.md`](docs/publishing.md) for the
packaging approach and republish steps). `JOBTRACK_HOME` gives the installed CLI a
real per-user data directory instead of assuming a monorepo layout on disk.

`apps/mcp` (`@jobtrack/mcp`) followed the same approach — a `bin/jobtrack-mcp.js`
entry point that defaults to the *same* `JOBTRACK_HOME` as the tray app, so
installing both shares one database automatically.

What's left before this matches the original vision:

- Trade-off still stands as documented: this needs Node.js already on the
  machine, since it runs the TypeScript sources via `tsx` rather than a compiled,
  dependency-free binary.
- No tray icon on macOS/Linux yet (runs headless there today).
- Publishing now runs from GitHub Actions rather than a maintainer's laptop —
  see item 7.

## 2. `.env.example` + onboarding — ✅ done

Added at the repo root, covering every var `apps/api/src/config.ts` reads. The
tray app's "Open App Settings" also seeds `.env` from it automatically on first
use.

## 3. Hot-swap DB switching

DB target switching (`apps/api/src/db/targets.ts`) currently works by having the
server self-exit and relying on an external process supervisor (pm2, systemd,
Docker's restart policy) to bring it back up — a documented caveat in the README.
Once the app is tray-managed per item 1, the tray process itself becomes that
supervisor, so it's worth revisiting: explore an in-process hot-swap that avoids
the restart/supervisor dependency entirely.

## 4. Split docs into a `/docs` folder — 🚧 started

`docs/publishing.md` now holds the npm-publishing walkthrough (moved out of the
Tray app section). Still to move out of the root `README.md` (~350 lines): the
storage/Postgres, import/export, MCP server, backup & restore, and
dependency-override sections, once the root README is slimmed to an overview,
quick start, and links.

## 5. CI pipeline — ✅ done

`.github/workflows/ci.yml` runs `npm run typecheck` and the vitest suite (205
tests across `apps/api`, `apps/web`, and `packages/shared`) on every push to
`main` and every pull request, so regressions are caught before merge. Nothing
there needs the network — the search suite runs on `FakeEmbedder` rather than
downloading a transformers model.

## 6. Real backup encryption

The `.jtbak` backup format (`apps/api/src/backup/codec.ts`) currently does gzip
plus a fixed XOR keystream — obfuscation, not real encryption, as the README
already notes. Add an optional passphrase-based encryption mode for people backing
up to shared drives or cloud storage.

## 7. Publish from GitHub Actions with provenance — ✅ done

`.github/workflows/publish.yml` replaces the run-from-a-laptop step. It's manual
(`workflow_dispatch`) and defaults to a dry run, so a real publish is always a
deliberate choice — the workflow's stand-in for `publish-all.ps1`'s typed `yes`.

Authentication is npm trusted publishing (OIDC), not a stored `NPM_TOKEN`, and
`npm publish --provenance` attaches a signed Sigstore attestation binding each
tarball to the exact workflow run and commit SHA. Both need `id-token: write`, a
public repo and public packages. The one manual setup step is per-package: each of
the four needs a trusted publisher configured on npmjs.com naming this repo and the
workflow filename — see [`docs/publishing.md`](docs/publishing.md#publishing-from-github-actions).

The gates a local script couldn't enforce now live in
`scripts/check-publishable.mjs`, which runs before anything is published:

- A package whose version is already on the registry **with different contents**
  fails the build. That's the defect that shipped `@jobtrack/api`'s post-refactor
  sources under an already-published version number — npm kept serving the old
  tarball and the installed CLI failed on an import that didn't exist yet — turned
  into a red build rather than a broken global install.
- It compares the published tarball against a freshly packed one rather than
  comparing version numbers, so it catches source drift that a version check can't
  see. Line endings are normalized first, since tarballs packed on Windows carry
  CRLF where a Linux CI checkout has LF.
- A package that bundles sources it doesn't own declares them (`apps/tray` stages a
  built `apps/web` plus the root `.env.example` into `vendor/`). Those reach the
  tarball only as build output, which is excluded from the comparison, so git
  answers instead: did any of them change after the commit that set the current
  version? Not theoretical — `jobtrack@1.0.6` was live on npm with a web UI two
  commits stale, missing the note-editing work, and nothing would have caught it.
- Publishing happens from a clean checkout, so `prepack`-staged assets are always
  rebuilt from source — the second failure was a stale `apps/tray/vendor` from an
  earlier publish shadowing a freshly built web UI.

The dependency order (`@jobtrack/shared` → `@jobtrack/api` → the two leaf packages)
and the already-published skip both carry over from `publish-all.ps1`, which stays
around for local dry runs.

What's left: `publish-all.ps1` and the workflow now encode the same package list in
two places. And the bundled-sources list is hand-maintained — if `apps/web` grows a
dependency on something outside itself, that path has to be added to the tray's
`bundles` entry by hand or the gate won't see it.
