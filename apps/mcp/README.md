# @jobtrack/mcp

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server (stdio
transport) for [JobTrack](https://github.com/CuplexUser/JobTrack) — a personal
job-application tracker with hybrid semantic search and duplicate detection. Point an MCP
client (Claude Desktop, Claude Code) at it to read and write job applications directly:
"log that I applied to Spotify today", "what's still awaiting a reply", "save this posting
for later".

It talks to the SQLite database directly — the exact same `services/*.service.ts` functions
the JobTrack REST API calls, via `@jobtrack/api`'s `exports` map — so it doesn't need the API
server running. Tools cover create/update/status-change for applications, companies, notes,
tags and job openings, plus every read (list/get/search/dashboard) — deliberately **no
delete tools**, so an MCP client can only add to or edit data, never destroy it.

## Install

```bash
npm install -g @jobtrack/mcp
```

Then point an MCP client at the installed `jobtrack-mcp` command:

```json
{
  "mcpServers": {
    "jobtrack": {
      "command": "jobtrack-mcp"
    }
  }
}
```

By default this reads/writes the same per-user database as the
[`jobtrack`](https://www.npmjs.com/package/jobtrack) tray app
(`%APPDATA%\jobtrack` on Windows, `~/.local/share/jobtrack` elsewhere) — install both and they
share data with no extra configuration. Set `JOBTRACK_HOME` in the MCP client's `env` to point
this at a different data directory instead.

Requires **Node.js 24+** already installed on the machine — this runs the TypeScript sources
via `tsx` rather than shipping a compiled, dependency-free binary.

## Source

<https://github.com/CuplexUser/JobTrack> — see the main repo README's
[MCP server](https://github.com/CuplexUser/JobTrack#mcp-server) section for the full tool
list and how it's implemented.
