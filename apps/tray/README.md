# jobtrack

A personal job-application tracker, packaged as a single command. It runs the API and the
built web UI as one background process, with a Windows tray icon (open UI / toggle
autostart / open settings / quit) — no terminal window, no separate dev server.

Record what you applied for, where and when; find it again by meaning rather than exact
wording; and see *before* you enter a new application whether you've already been down that
road with the same company. Single user, runs on your machine, data in a local SQLite file.

## Install

```bash
npm install -g jobtrack
jobtrack
```

Requires **Node.js 24+** already installed on the machine — this runs the app's TypeScript
sources via `tsx` rather than shipping a compiled, dependency-free binary.

## What you get

- **Open JobTrack** — opens the UI in your default browser.
- **Autostart with Windows** — toggles a per-user Registry Run key, no admin rights needed.
- **Open App Settings** — opens `.env` in Notepad, seeded from a template on first use.
- **Quit** — stops the server and the tray icon together.

Windows only for the tray icon today — elsewhere, `jobtrack` still runs the combined server,
just without a tray icon (Ctrl+C to stop).

Data (SQLite database, model cache, active-DB-target pointer) lives under a per-user
`JOBTRACK_HOME` directory (`%APPDATA%\jobtrack` by default on Windows).

## Source

<https://github.com/CuplexUser/JobTrack> — see the main repo README for the full feature set,
MCP server, CSV/Excel import, and backup/restore.
