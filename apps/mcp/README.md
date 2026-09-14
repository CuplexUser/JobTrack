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

Beyond the plain records it can capture a posting from a link or pasted text
(`capture_posting`), list what is waiting on you today (`get_agenda`), change several
statuses at once (`bulk_change_status`) and sweep for duplicates (`find_duplicate_groups`).
It knows what you are looking for (`get_profile`, `update_profile`), ranks your saved
openings against it (`rank_openings`) and scores postings before you save them
(`score_postings`), so it can tell which of the jobs it finds are worth adding. It keeps track of your network too (`list_contacts`, `log_interaction`, `link_contact` and
friends), and `check_duplicate` names who you know at a company. It also ships prompts for
the routine chores: `weekly_review`, `triage_openings`, `log_email_update`,
`prepare_application`, `interview_prep` and `draft_outreach`.

## Install

On Windows, the [JobTrack installer](https://github.com/CuplexUser/JobTrack/releases/latest)
already includes this server and connects Claude Desktop to it, updating it with every install.
You do not need the steps below.

```bash
npm install -g @jobtrack/mcp
```

A global install is not updated by anything else, including updating the `jobtrack` tray app.
Run `npm install -g @jobtrack/mcp@latest` to update it, then restart the MCP client. The server
prints its version when it starts (`[jobtrack-mcp] 1.3.1 ready`), which MCP clients keep in
their logs.

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
