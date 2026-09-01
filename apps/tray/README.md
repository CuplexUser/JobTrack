# jobtrack

A personal job-application tracker, packaged as a single command. It runs the API and the
built web UI as one background process, with a Windows tray icon (open UI / toggle
autostart / open settings / quit) — no terminal window, no separate dev server.

Record what you applied for, where and when; find it again by meaning rather than exact
wording; and see *before* you enter a new application whether you've already been down that
road with the same company. Single user, runs on your machine, data in a local SQLite file.

## Install

**On Windows**, prefer the installer:
[**JobTrack-Setup**](https://github.com/CuplexUser/JobTrack/releases/latest). It needs no admin
rights and no Node.js, adds a native tray icon and a settings dialog, and starts silently at
sign-in rather than opening a console window.

Everywhere else — and for development on Windows too:

```bash
npm install -g jobtrack
jobtrack
```

That route requires **Node.js 24+** already installed on the machine, since it runs the app's
TypeScript sources via `tsx` rather than shipping a compiled, dependency-free binary. Both routes
use the same `%APPDATA%\jobtrack` data directory, so they share one database — install only one of
them at a time, or the two will collide on port 3001.

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
