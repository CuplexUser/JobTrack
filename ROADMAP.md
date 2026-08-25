# Roadmap

A living list of directions for JobTrack — not commitments or dates, just the
things worth doing next in rough priority order.

## 1. Background tray app via npm global install — ✅ implemented locally

`apps/tray` now runs the API and the built web UI as one process, with a Windows
tray icon (open UI / toggle autostart / open settings / quit) — see the README's
[Tray app](README.md#tray-app) section for how to run it. What's left before this
matches the original vision:

- Actually publish it to the npm registry as `npm install -g jobtrack`. Today it's
  a workspace package (`@jobtrack/tray`) runnable via `npm run tray` from a clone
  of this repo, not a standalone global install.
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

## 4. Split docs into a `/docs` folder

All documentation currently lives in a single `README.md` (~340 lines), including
a full "MCP server" section for `apps/mcp`, which has no docs of its own. Slim the
root README down to an overview, quick start, and links, and move the
storage/Postgres, import/export, MCP server, backup & restore, and
dependency-override sections into files under a new `docs/` folder for easier
navigation.

## 5. CI pipeline

No `.github/workflows` exists yet. Add a workflow that runs `npm run typecheck`
and the existing vitest suite (144 tests across `apps/api`, `apps/web`, and
`packages/shared`) on push/PR, so regressions are caught before merge.

## 6. Real backup encryption

The `.jtbak` backup format (`apps/api/src/backup/codec.ts`) currently does gzip
plus a fixed XOR keystream — obfuscation, not real encryption, as the README
already notes. Add an optional passphrase-based encryption mode for people backing
up to shared drives or cloud storage.
