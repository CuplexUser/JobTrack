# Roadmap

A living list of directions for JobTrack — not commitments or dates, just the
things worth doing next in rough priority order.

## 1. Background tray app via npm global install

Today JobTrack has to be started by hand (`npm run dev`) and lives in a terminal
window. The goal is a persistent, background-running app you barely think about —
similar in feel to Claude Desktop's tray presence, but built as an **npm global
package** rather than a fully native executable, since that's dramatically less
packaging work and this project already assumes Node.js.

- Publish as a global package (e.g. `npm install -g jobtrack`) exposing a
  `jobtrack` CLI command.
- The CLI starts the API and serves the built web UI. Note: the Fastify API
  (`apps/api/src/app.ts`) currently only exposes JSON endpoints — it never serves
  static files — so this item also means adding static-file serving (or a small
  bundled static server) so a single process can serve both, matching a "one app
  is running" tray experience.
- A Windows system tray icon (via a lightweight Node tray package) with a menu:
  open the UI in the default browser, toggle autostart with Windows, open app
  settings, quit.
- Autostart toggle: write/remove a Windows Registry `Run` key or a Startup-folder
  shortcut. No such mechanism exists in the repo today.
- "Open app settings" opens the `.env` file (or its folder) — see item 2.
- Trade-off to document clearly: this approach requires Node.js to already be
  installed on the machine, unlike a fully native executable + installer.

## 2. `.env.example` + onboarding

No `.env` or `.env.example` exists anywhere in the repo — the environment
variables (`DB_DRIVER`, `DB_FILE`, `DATABASE_URL`, `DB_TARGETS`, `PORT`, `HOST`,
`SEMANTIC_SEARCH`, `EMBEDDING_MODEL`, `MODEL_CACHE_DIR`) are only documented in a
README table. Add a checked-in `.env.example` with sane defaults and inline
comments, so new installs (and the tray app's "open settings" affordance from
item 1) have a real file to point at instead of a doc lookup.

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
