# Roadmap

A living list of directions for JobTrack — not commitments or dates, just the
things worth doing next in rough priority order.

## 1. Background tray app via npm global install — ✅ implemented and publish-ready

`apps/tray` (package name `jobtrack`) runs the API and the built web UI as one
process, with a Windows tray icon (open UI / toggle autostart / open settings /
quit) — see the README's [Tray app](README.md#tray-app) section, including
"Publishing it as `npm install -g jobtrack`". `@jobtrack/api`/`@jobtrack/shared`
are real versioned dependencies (not workspace-only `*`), the web UI + a
`.env.example` template get vendored into the package at pack time, and
`JOBTRACK_HOME` gives the installed CLI a real per-user data directory instead of
assuming a monorepo layout on disk. Verified with a standalone install (three
packed tarballs, installed as dependencies outside this repo) — full API + web UI
+ tray icon, no monorepo in sight.

What's left before this matches the original vision:

- Actually run `npm publish` for `@jobtrack/shared`, `@jobtrack/api`, then
  `jobtrack`, in that order, from a real npm account. Nothing here does that
  automatically — it's a manual, one-way step.
- Trade-off still stands as documented: this needs Node.js already on the
  machine, since it runs the TypeScript sources via `tsx` rather than a compiled,
  dependency-free binary.
- No tray icon on macOS/Linux yet (runs headless there today).

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

## 5. CI pipeline

No `.github/workflows` exists yet. Add a workflow that runs `npm run typecheck`
and the existing vitest suite (144 tests across `apps/api`, `apps/web`, and
`packages/shared`) on push/PR, so regressions are caught before merge.

## 6. Real backup encryption

The `.jtbak` backup format (`apps/api/src/backup/codec.ts`) currently does gzip
plus a fixed XOR keystream — obfuscation, not real encryption, as the README
already notes. Add an optional passphrase-based encryption mode for people backing
up to shared drives or cloud storage.
