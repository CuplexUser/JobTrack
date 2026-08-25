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
npm run dev       # API on :3001, web on :5173
```

Open <http://localhost:5173>.

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

**Everything else.** Applications divided by year and month, full status pipeline with a
dated history, companies as first-class records, a free-form tag vocabulary attachable to
both companies and applications, notes that link to either, and CSV/Excel export.

---

## Layout

```
apps/web/          React 19 + Vite + Ant Design 6      :5173
apps/api/          Fastify + repolayer + search        :3001
packages/shared/   domain types, zod schemas, pure logic
data/jobtrack.db   SQLite (gitignored)
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

| variable | default | meaning |
|---|---|---|
| `DB_DRIVER` | `sqlite` | `sqlite`, `postgres` or `mysql` |
| `DB_FILE` | `data/jobtrack.db` | SQLite only |
| `DATABASE_URL` | — | required for postgres/mysql |
| `PORT` / `HOST` | `3001` / `127.0.0.1` | API bind address |
| `SEMANTIC_SEARCH` | `true` | `false` skips the model entirely; search stays lexical |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | any transformers.js feature-extraction model |
| `MODEL_CACHE_DIR` | `.models` | where the ONNX model is cached |

---

## Scripts

| command | does |
|---|---|
| `npm run dev` | API + web + shared in watch mode |
| `npm test` | all three workspaces (144 tests) |
| `npm run typecheck` | `tsc --build` across the project references |
| `npm run build` | production web bundle |
| `npm run seed` | sample data (`-- --force` to add to a non-empty database) |
| `npm run clean` | remove build output and caches |
| `npm run icons --workspace=@jobtrack/web` | regenerate favicon.ico / apple-touch-icon from the SVG sources |

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
