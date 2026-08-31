# JobTrack

A personal job-application tracker. Record what you applied for, where and when; find it
again by meaning rather than exact wording; and — the point of the whole thing — see
*before* you enter a new application whether you have already been down that road with the
same company.

Single user, runs on your machine, data in a local SQLite file.

---

## Quick start

```bash
npm install
npm run seed      # 40 sample applications across 2024-2026 (skip for an empty database)
npm run dev       # API on :3002, web on :5173
```

Open <http://localhost:5173>.

`npm run dev` binds the API to :3002, not the API's usual :3001 default (see
"Configuration" below) — that keeps it from colliding with a `tray` build already running
on this machine, so both can be up at the same time.

The first search after startup is keyword-only for about a minute while the embedding model
downloads (~25 MB, once per machine). The UI says so while it happens, and everything else
works normally meanwhile.

Requires **Node 24+** (`node:sqlite` is stable there; repolayer needs ≥22.5). Developed on
Node 26.7 / npm 11.12.

---

## What it does

**Duplicate detection.** The feature everything else is arranged around. As you type a
company and job title into the New Application form, a debounced check runs and reports one
of four verdicts:

| verdict | meaning |
|---|---|
| `exact` | same company, same normalized title — saving requires confirmation |
| `similar` | same company, and the titles match on wording (Dice ≥ 0.8) or on meaning (cosine ≥ 0.75) |
| `company` | you have applied here before, for a different role |
| `none` | genuinely new |

Company names are normalized before comparison — lowercased, de-accented, legal suffixes
stripped — so `Spotify AB`, `spotify` and `Spotify, Inc.` are one employer, not three. In
the seed data that is why 40 applications produce 32 companies.

The same check is available without starting an application, from the dashboard's *Check
before you apply* box.

**Hybrid search.** Two retrievers over the same documents, fused by
[Reciprocal Rank Fusion](https://dl.acm.org/doi/10.1145/1571941.1572114):

- **Lexical** (MiniSearch): typo-tolerant BM25. Finds `pyhton devloper`.
- **Semantic** (all-MiniLM-L6-v2 via transformers.js, local, no API key): finds *Backend
  Engineer* when you searched `server-side developer` — no shared words at all.

Ranks are fused rather than scores, because BM25 is unbounded and cosine sits in [-1, 1];
normalizing between them would mean inventing a conversion that is wrong in ways nobody can
see. The semantic half has a similarity floor, because vector search has no concept of "no
match" and will otherwise return the whole table ranked by accident.

**Job openings.** A lighter-weight record for a role you found but are not ready to apply
to yet — no status, no tags, just enough to find it again. "Convert" turns one into a real,
tracked application on demand, using the same company-resolution and creation path the New
Application form uses; the opening itself is kept (marked archived), not deleted, so there is
still a record of what it became.

**Capture from the web.** Three ways to get a posting in without retyping it: paste a link
and the API reads the site's own `schema.org/JobPosting` data, paste the text and it is
parsed locally, or click a browser extension on the page you are already looking at. The
last one is what makes LinkedIn and Indeed work — they block servers, not the browser you
are reading them in. All three land as a job opening, run the same duplicate check, and are
written up in [`docs/capture.md`](docs/capture.md).

**Everything else.** Applications divided by year and month, full status pipeline with a
dated history, companies as first-class records, a free-form tag vocabulary attachable to
both companies and applications, notes that link to either, CSV/Excel export and import, and
a Settings page for switching between pre-configured databases and for full-fidelity
backup/restore (see "Switching databases" and "Backup & restore" below).

**A dashboard that reads the history, not just the current state.** The pipeline funnel
counts what each application *ever reached*, so one that interviewed and was then turned
down still counts at the interview stage — which is the only way the conversion rate between
stages means anything. Alongside it: applications per month over two years, and a "gone
quiet" list of live applications with no follow-up date that nothing has moved in three
weeks. Charts are inline SVG against the app's palette; no charting dependency.

---

## Layout

```
apps/web/          React 19 + Vite + Ant Design 6      :5173
apps/api/          Fastify + repolayer + search        :3001
apps/mcp/          MCP server (stdio) over the same repos, publishable as `@jobtrack/mcp`
apps/tray/         background process + Windows tray icon, publishable as `jobtrack`
apps/extension/    browser extension that clips a posting into an opening (not published)
packages/shared/   domain types, zod schemas, pure logic
data/jobtrack.db   SQLite (gitignored)
docs/              longer reference docs (web capture, npm publishing, ...)
```

npm workspaces — one `npm install` at the root covers everything.

`packages/shared` is **browser-safe** and must not import repolayer. The database row types
live in `apps/api/src/db/schema.ts`; a compile-time test
(`apps/api/test/schema-contract.test.ts`) asserts the two never drift apart.

---

## Storage, and the Postgres path

Data access goes through [repolayer](https://www.npmjs.com/package/repolayer), so the engine
is one config value:

```bash
npm install pg
DB_DRIVER=postgres DATABASE_URL=postgres://... npm run dev
```

Nothing outside `apps/api/src/db/repos.ts` names a driver, and every query stays inside
repolayer's portable operator set — there is no dialect-specific SQL anywhere in the app.

That portability costs something, and the design works around it deliberately:

| repolayer has no… | so instead |
|---|---|
| joins or relations | `apps/api/src/db/hydrate.ts` stitches rows with batched `in` queries — three queries per page regardless of page size, with a test that counts them |
| aggregation beyond `count()` | year/month totals are tallied in one pass in JS |
| SQL date functions | `periodYear` / `periodMonth` are denormalized columns, written from `appliedOn` in exactly one place |
| full-text search | search is built above the repo (see above) |
| identifier quoting | no column is named after a reserved word — the job title column is `job_title`, never `position` |
| cascading deletes | deletes clean up their own tag links, notes, status events and vectors, in a transaction |

### Configuration

Every variable below can be set in the environment or in a **`.env` file in the app data
directory** — the repo root for a clone, `%APPDATA%\jobtrack` (or `~/.local/share/jobtrack`)
for an installed `jobtrack`, which is the file the tray's *Open App Settings* opens. It is
read at startup by the API, the tray and the MCP server alike. A variable set in the real
environment wins over the file, so `PORT=3002 npm run dev` still overrides it.

| variable | default | meaning |
|---|---|---|
| `DB_DRIVER` | `sqlite` | `sqlite`, `postgres` or `mysql` — the implicit `"default"` target |
| `DB_FILE` | `data/jobtrack.db` | SQLite only; a bare filename is a second database in `data/`, a relative path resolves from the app data directory |
| `DATABASE_URL` | — | required for postgres/mysql |
| `DB_TARGETS` | — | JSON array of *additional* named targets, see below |
| `PORT` / `HOST` | `3001` / `127.0.0.1` | API bind address |
| `SEMANTIC_SEARCH` | `true` | `false` skips the model entirely; search stays lexical |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | any transformers.js feature-extraction model |
| `MODEL_CACHE_DIR` | `.models` | where the ONNX model is cached; relative to the app data directory |
| `CORS_ORIGINS` | — | extra browser origins allowed without a token, comma-separated |
| `API_TOKEN` | generated | what a browser extension presents; kept in `data/api-token` |

### Who can call the API

The API binds to `127.0.0.1`, but that still leaves it reachable from every page open in the
browser on the same machine — so it does not reflect arbitrary origins. A wrong token is
refused outright; a request with no `Origin` header (curl, the MCP server, the tray itself)
is allowed; a request from this app's own UI is allowed; anything else needs the token,
which is how the browser extension gets in. `GET /api/meta` stays open as a health probe,
and `GET /api/auth/check` is the reverse — only a valid token opens it, so "is this token
right?" has an answer that depends on nothing else. Details and the reasoning are in
[`docs/capture.md`](docs/capture.md#the-token-and-why-the-api-needed-one).

### Switching databases

`DB_DRIVER` / `DB_FILE` / `DATABASE_URL` always describe one implicit target named
`"default"`. `DB_TARGETS` can name more:

```bash
DB_TARGETS='[{"name":"cloud","driver":"postgres","url":"postgres://user:pass@host/db"}]'
```

When more than one target is configured, the app's **Settings** page shows a switcher.
Connection settings themselves are never shown or editable there — only `.env` holds them.
Switching writes which target is active to `data/active-db.json` (a name only, never a
credential) and **restarts the server** to connect to it — it is not a live hot-swap. That
means something has to bring the process back up:

- `npm run dev`'s `tsx watch` does **not** restart on a self-exit (only on a file change), so
  a dev server needs restarting by hand after a switch.
- A production deployment needs a process supervisor with a restart policy — pm2, systemd
  `Restart=always`, Docker `restart: unless-stopped`, or similar — for the switch to be
  seamless.

---

## Scripts

| command | does |
|---|---|
| `npm run dev` | API + web + shared in watch mode |
| `npm test` | every workspace (263 tests) |
| `npm run typecheck` | `tsc --build` across the project references |
| `npm run build` | production web bundle |
| `npm run seed` | sample data (`-- --force` to add to a non-empty database) |
| `npm run mcp` | start the MCP server (stdio) — see [MCP server](#mcp-server) |
| `npm run tray` | run the API + web UI as one process, with a Windows tray icon — see [Tray app](#tray-app) |
| `npm run clean` | remove build output and caches |
| `npm run icons --workspace=@jobtrack/web` | regenerate favicon.ico / apple-touch-icon from the SVG sources |
| `npm run build --workspace=@jobtrack/extension` | build the browser clipper into `apps/extension/dist` (load unpacked) |

---

## Testing

Vitest across three projects.

Service tests run against repolayer's `MemoryRepo` — no database, no fixtures, no cleanup —
which is trustworthy only because it passes the same conformance suite as the SQLite
adapter. The embedder is injected, so tests use a deterministic fake and never download a
model.

One suite (`sqlite-integration.test.ts`) runs against a real temporary SQLite file, because
a fake cannot prove that `ensureTable()` emits DDL a real engine accepts or that a `Date`
survives storage unchanged.

> **One caveat worth knowing.** repolayer's `timestamps: true` shorthand is honored by the
> SQLite adapter but leaves both fields `null` on `MemoryRepo`. Both this app and its test
> support use the explicit `{ createdAt, updatedAt }` form, which behaves identically on
> both. Worth a conformance case upstream.

---

## Export

CSV and `.xlsx`, both driven by the same filter object as the list view — so what you export
is exactly what you were looking at, including an active search.

Five columns: **Position, Company, Date, Status, Notes**. A list, not a report; there is no
summary or statistics sheet. The workbook keeps one worksheet per year, matching how the app
organizes applications everywhere else.

CSV is written by hand against RFC 4180 with a UTF-8 BOM, so titles containing commas do not
shift columns and `Malmö` survives a double-click into Excel.

> **Why the buffered xlsx writer.** exceljs's *streaming* `WorkbookWriter` produced archives
> whose zip central directory recorded `crc = 0` and `uncompressed size = 0` for several
> entries. The compressed bytes were intact, so lenient readers — including exceljs's own —
> opened them happily, while spec-correct readers saw those entries as empty and rejected
> the workbook. `writeBuffer()` uses a different packing path and is correct. The tests now
> assert on the central directory directly (`test/support/zip.ts`) rather than round-tripping
> through the library that wrote the file, since that tolerance is what let the bug through.

---

## Import

CSV and `.xlsx`, in the same 5-column shape Export produces — Position, Company, Date,
Status, Notes, matched by header name rather than position. The obvious source is the app's
own Export output, so a filtered export round-trips back in; a hand-built spreadsheet in the
same shape works too.

Two steps, both hitting `POST /api/import?format=csv|xlsx&mode=preview|commit`, and neither
holds server-side upload state — the browser just posts the same file twice:

1. **Preview** parses and validates every row against the exact zod schema the New
   Application form uses, then runs each one through the same duplicate check the form runs
   while you type. A row whose verdict is `exact` — the same rule
   [`shouldBlockSave`](packages/shared/src/duplicates.ts) uses everywhere else — is marked
   a duplicate and will be skipped; everything else is `new`. Two identical rows *within*
   the same file are caught too, even though neither is in the database yet.
2. **Commit** re-runs that classification and creates every `new` row through the same
   `createApplication` call the API and the web form use — company resolution, the opening
   status event, the linked note, all included. Duplicates are skipped, not overwritten; a
   row that fails to parse is reported and does not stop the rest of the batch.

The one thing that does not round-trip exactly: Export merges every note on an application
into one `Notes` cell, so Import creates that cell back as a single new note rather than
reconstructing the original set.

---

## Capturing postings from the web

Paste a link, paste the text, or click a browser extension on the posting you are reading.
All three produce a job opening through the same path the form uses, with the same duplicate
check attached.

```bash
npm run build --workspace=@jobtrack/extension   # then load apps/extension/dist unpacked
```

Which route works where is not a detail — LinkedIn, Indeed and Glassdoor block servers from
reading postings, so the link route cannot work there and the extension is the answer, since
it reads the page already rendered in your own browser. The full write-up, the extension's
setup and the API token it needs are in [`docs/capture.md`](docs/capture.md).

---

## MCP server

`apps/mcp` is a standalone [Model Context Protocol](https://modelcontextprotocol.io) server
(stdio transport) so an MCP client — Claude Desktop, Claude Code — can read and write
JobTrack data directly: "log that I applied to Spotify today", "what's still awaiting a
reply", "save this posting for later".

It talks to the database **directly**, not through the REST API: it calls
`createRepos(config)` and the exact same `services/*.service.ts` functions the routes call
(exposed to it via a small `exports` map in `apps/api/package.json`), so it works whether or
not `npm run dev` is running. The same SQLite connection settings apply, including the
`busyTimeoutMs` that makes two processes touching the file at once safe.

Tools cover create/update/status-change for applications, companies, notes, tags and job
openings, plus every read (list/get/search/dashboard) — deliberately **no delete tools**, so
an MCP client cannot destroy data, only add to or edit it.

```bash
npm run mcp   # runs it directly, for manual testing (e.g. with @modelcontextprotocol/inspector)
```

`apps/mcp` is also published standalone as [`@jobtrack/mcp`](https://www.npmjs.com/package/@jobtrack/mcp)
— see [`docs/publishing.md`](docs/publishing.md). That's the easiest way to point an MCP
client at it:

```bash
npm install -g @jobtrack/mcp
```

```json
{
  "mcpServers": {
    "jobtrack": {
      "command": "jobtrack-mcp"
    }
  }
}
```

`bin/jobtrack-mcp.js` defaults `JOBTRACK_HOME` to the same per-user directory
(`%APPDATA%\jobtrack` on Windows) that the globally-installed `jobtrack` tray app defaults
to — install both and they share one database with no extra configuration.

Running from a repo clone instead (`npx tsx apps/mcp/src/index.ts`, as below) skips that
default — it falls back to this repo's own `data/jobtrack.db`, same as `npm run dev`, unless
you set `JOBTRACK_HOME` yourself:

```json
{
  "mcpServers": {
    "jobtrack": {
      "command": "npx",
      "args": ["tsx", "apps/mcp/src/index.ts"],
      "cwd": "/path/to/JobTrack",
      "env": { "JOBTRACK_HOME": "<per-user path, to share data with an installed jobtrack>" }
    }
  }
}
```

> **One caveat worth knowing.** If the API dev server is also running, each process keeps
> its own in-memory search index. A write made through MCP calls *that process's own*
> `search.markStale()` — the web app's search results only pick it up once its own index is
> separately invalidated (a later write there, or a restart). Every other read — lists,
> detail pages, the dashboard — hits SQLite directly and is unaffected.

---

## Tray app

`apps/tray` runs the API and the built web UI as one background process, with a Windows
tray icon for the rest — no terminal window, no separate `npm run dev`. It composes the same
`buildApp` the API server itself uses (`apps/api/src/app.ts`) with `@fastify/static` serving
`apps/web/dist`, so one process answers both `/api/*` and the SPA.

```bash
npm run build   # apps/web/dist must exist — the tray serves it, it doesn't build it
npm run tray
```

The tray menu has four items:

- **Open JobTrack** — opens the UI in your default browser.
- **Autostart with Windows** — toggles a per-user Registry Run key
  (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), no admin rights needed.
- **Open App Settings** — opens `.env` in Notepad, seeding it from `.env.example` first if
  it doesn't exist yet.
- **Quit** — stops the server and the tray icon together.

Windows only for now — elsewhere, `npm run tray` still runs the combined server, just
without a tray icon (Ctrl+C to stop). It also expects Node.js already installed on the
machine.

### Publishing it as `npm install -g jobtrack`

`apps/tray` (package name `jobtrack`), `apps/mcp` (`@jobtrack/mcp`), `@jobtrack/api`, and
`@jobtrack/shared` are all set up to be published standalone, not just run from a clone of
this repo — see [`docs/publishing.md`](docs/publishing.md) for how the packaging works and
the exact `npm publish` steps.

---

## Backup & restore

The **Settings** page can export a full-fidelity snapshot of every table — every field, every
id, every relation — and restore it later. This is a different thing from the CSV/Excel
export elsewhere in the app, which is a deliberately lossy report meant for a person to read
(`apps/api/src/export/columns.ts`). A backup is meant to be read back by JobTrack itself and
reconstruct the database exactly, so it's useful for:

- **Resetting** a database seeded with test data, on any driver — restore an empty/earlier
  snapshot, or just don't restore at all and use the database with confidence it's really
  clean.
- **Disaster recovery** — export regularly, restore onto a fresh install if something goes
  wrong.
- **Migrating drivers** — export from SQLite, switch the active target to Postgres (see
  "Switching databases" above), import the same file there.

A restore **replaces** everything in the active database — every backed-up table is wiped and
recreated from the file, inside one transaction, not merged with what's already there.

The file (`.jtbak`) is gzip-compressed and then obfuscated with a fixed XOR keystream, so it
isn't plain, readable JSON if it's opened in a text editor. **This is not encryption** — there
is no passphrase, the "key" is a constant in `apps/api/src/backup/codec.ts`, and it does not
protect the personal data inside (salaries, notes, company names) from anyone who actually
wants it. Treat a `.jtbak` file the same way you'd treat a database dump.

One known gap: repolayer stamps `createdAt`/`updatedAt` to the moment of restore — it has no
way to pass a specific timestamp through `create()`. Every other field, including all of the
app's own date fields (`appliedOn`, `savedOn`, `occurredOn`, …), round-trips exactly.

`searchVectors` (embeddings) is deliberately excluded — it's fully derived from the other
tables' text and rebuilds itself automatically after a restore.

### Reset & demo data

The same Settings page has a **Clear database** button (every backed-up table wiped, nothing
recreated — type `CLEAR` to confirm) and, only while the active database is empty, a **Seed
with demo data** button that writes the same realistic multi-year job search
`npm run seed` does (`apps/api/src/backup/seed.ts`, shared by both). The API refuses to seed a
database that already has data in it — clear it first — so this is a safe pair of buttons to
leave on a page nobody but you can reach.

---

## Dependency notes

`npm audit` is clean. Three transitive packages are pinned forward via `overrides` in the
root `package.json`:

- **sharp** `^0.35.3` — versions below 0.35.0 inherit four libvips CVEs. Arrives via
  transformers for image pipelines this app never uses.
- **adm-zip** `^0.6.0` — via onnxruntime-node.
- **uuid** `^11.1.1` — exceljs pins uuid@7 but only calls `require('uuid').v4`, which v11
  still exports from its CJS build.

Changing `overrides` requires a clean install (`rm -rf node_modules package-lock.json &&
npm install`) — npm's incremental install silently ignores them otherwise.
