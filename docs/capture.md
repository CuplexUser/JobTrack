# Capturing postings from the web

Three ways to get a job ad into JobTrack without retyping it, and one piece of security that
had to come with them.

All three end in the same place: a **job opening** — the lightweight record for something
you found but have not applied to yet — created through the same `createOpening` path the
form uses, with the same company resolution. And all three run the same duplicate check the
New Application form runs while you type, so saving a posting from a company you have
already applied to tells you so at the moment you save it — while the extension's save route
declines outright to store the same posting twice.

---

## What works where, and why

There is no usable LinkedIn API for job data. The Jobs API is partner-only (Talent
Solutions), and reading postings from a server is both against LinkedIn's terms and blocked
in practice — an unauthenticated fetch gets an auth wall or an HTTP 999. Indeed and
Glassdoor behave the same way. That is not a gap to be engineered around; it is the shape of
the problem, and it decides which route to use:

| | Paste a link | Paste the text | Browser extension |
|---|---|---|---|
| Greenhouse, Lever, Ashby, Workday, most career pages | ✅ best | ✅ | ✅ |
| LinkedIn, Indeed, Glassdoor | ❌ blocked | ✅ | ✅ |
| Platsbanken (arbetsformedlingen.se) | ✅ via its own API | ✅ | ✅ (routed through the API) |
| Needs the page open in your browser | no | no | yes |
| Needs the API to reach the internet | yes | no | yes, for Platsbanken only |

**Paste a link** (`POST /api/ingest/url`) fetches the page and reads the
[`schema.org/JobPosting`](https://schema.org/JobPosting) JSON-LD that most applicant
tracking systems publish. When it works it is the most accurate route by a distance — the
site is stating the fields rather than us inferring them. What that block leaves out — very
often the location, and nearly as often the description — is taken from the page itself,
read the way the extension reads one: main content only, no navigation and no footer. When a
site refuses, the API answers `422 ingest_blocked` and the UI moves you to the next tab
rather than showing a generic failure.

Platsbanken is the one exception to "read the page": it is a client-rendered SPA, so a
fetched page is always the same empty app shell, whatever ad is in the URL — there is no
JSON-LD to find there. A `arbetsformedlingen.se/platsbanken/annonser/<id>` link is instead
read from Arbetsförmedlingen's own public [Jobsearch
API](https://jobsearch.api.jobtechdev.se/), keyed by the same ID that is in the URL. The
extension takes the same detour for the same reason: it cannot reach that API directly (its
`host_permissions` name only the local JobTrack), so a Platsbanken tab is read by asking the
local API rather than by inspecting the tab's DOM.

**Paste the text** (`POST /api/ingest/text`) parses what you copied, with no network
involved. Heuristics, and honest about it: the first line is usually the title, a "Title at
Company" or "Title | Company | City" shape is recognized, and a currency figure near the
word "salary" becomes a salary. Everything you paste is also kept as the opening's note, so
a wrong guess never loses information — minus the rows of site navigation that come along
when the copy was made from a page rather than from the posting.

**The browser extension** reads the page you already have open, in your own session. This is
what makes LinkedIn and Indeed work: nothing is being fetched or scraped from a server —
the posting is already rendered on your screen, and pressing the button copies it once.

---

## The extension

`apps/extension`, Manifest V3. The released build is for **Firefox 140 or newer**, signed by
Mozilla and distributed from this repository rather than listed on addons.mozilla.org.

### Install it in Firefox

1. Open **https://cuplexuser.github.io/JobTrack/clipper/jobtrack-clipper.xpi** in Firefox.
   Firefox asks whether to allow the site to install an add-on; allow it, then **Add**.
   (If the file downloads instead, drag it onto a Firefox window, or use **Install Add-on From
   File** from the gear menu on `about:addons`.)
2. Open the add-on's settings (the **Settings** button in its popup), leave the address at
   `http://127.0.0.1:3001` and press **Connect to JobTrack**.
3. A JobTrack page opens in a new tab. Press **Allow** there. The tab closes and the settings
   page says it is connected.

It stays installed, and new versions arrive on their own through Firefox's normal add-on
updates.

Connecting needs JobTrack 1.3.0 or newer. Against an older one, the settings page says so and
opens **Enter the token by hand**, where the token from `data/api-token` goes instead (the
Windows tray menu has **Copy API token**).

**`npm run dev` runs the API on `3002`**, not 3001, so point the address there when testing
against a dev server. A repo clone and an installed `jobtrack` keep separate data directories
and therefore separate tokens; connecting always gets the token of the JobTrack the address
points at.

### Chrome and Edge

The same code runs in Chromium browsers, but there is no store listing for them yet, so they
can only load it unpacked, which needs developer mode:

```bash
npm run build --workspace=@jobtrack/extension
```

Then **Extensions → Developer mode → Load unpacked →** `apps/extension/dist`, and connect as
above.

### Using it

Open any job posting and click the extension. It shows what it read and from where;
correct anything, press **Save opening**, and it lands in JobTrack.

### How it reads a page

The company and the title are decided by the first of these that names both:

1. **The posting's own JSON-LD** — survives redesigns, and is what most ATS pages carry.
2. **Per-site selectors** — `apps/extension/src/sites.ts`, for the boards that publish no
   structured data.
3. **Your text selection, or the page title** — select the part of the page you care about
   before clicking and it will be used.

**The location, the salary and the note are filled from whichever of them can answer.** A
`JobPosting` block that states the company and the title but no city is completely ordinary,
and letting one source decide every field is what used to leave the location box empty on
postings that say where the job is in plain sight. So the page is asked next: a location
selector, then a line in the posting that labels one ("Location: Gothenburg"). A remote
posting that names no city at all is read off `jobLocationType` and
`applicantLocationRequirements` instead, as "Remote (Sweden)".

**The note is the posting, not the page it was printed on.** The description in the
structured data is preferred, since that is the ad itself. Failing that the page is read,
starting from whatever container holds the description, with the site's own furniture left
out — navigation, header, footer, cookie banner, share buttons — and lines like "Log in",
"Language" and "Search" dropped whole. Bullet lists stay bullet lists.

**The site selectors will break.** LinkedIn and Indeed reshuffle their markup on their own
schedule and owe this extension nothing, so a field coming back empty on one of them is
ordinary maintenance, not a mystery. Every selector lives in that one file, keyed by
hostname; fix the line and rebuild. The other two routes keep working regardless.

### Permissions, and what it does not do

`activeTab` and `scripting`, not a content script — the extension can read a page **only in
the moment you press its button**, and never runs on pages you merely visit.
`host_permissions` names your local JobTrack and nothing else, so it cannot talk to any
other server. The one other page it ever runs in is JobTrack's own connect page, and only
after you press **Connect to JobTrack**. It stores two things (the address and the token) and
sends the posting to your own machine. The privacy policy is
[`apps/extension/PRIVACY.md`](../apps/extension/PRIVACY.md).

---

## The token, and why the API needed one

The API binds to `127.0.0.1`, which is not reachable from the internet — but it *is*
reachable from every page open in the browser on the same machine. It used to run
`cors({ origin: true })` with no authentication, which meant any site you visited could
quietly POST applications into your database, or read every one back out. The clipper is
what made that worth exploiting, so the fix ships with it.

Requests are judged in four steps (`apps/api/src/lib/request-guard.ts`):

0. **A token that is presented and wrong** → refused, before anything else is considered.
1. **No `Origin` header** → allowed. That is a non-browser caller: curl, the MCP server, the
   tray's own process.
2. **A known origin** → allowed. The tray's own address, the `:5173` dev server, and
   anything in `CORS_ORIGINS`.
3. **Anything else** → must present the token, as `Authorization: Bearer <token>` or
   `X-JobTrack-Token`. This is the extension's door, because its origin
   (`moz-extension://<uuid>` in Firefox, `chrome-extension://<id>` in Chromium) cannot be
   known until it is installed.

Rule 1 is narrower than it sounds, and worth stating exactly: browsers send `Origin` on
cross-origin **POSTs** (form posts included) but **not on GETs**, so a hostile page's
cross-origin GET does land in rule 1. It still cannot read the reply — without CORS headers
the response is opaque to it, and JSON is not valid script, so there is no `<script src>`
trick either. What rule 1 cannot be used for is *writing*, which is the part worth
protecting.

Rule 0 exists because that same exemption made credential checks meaningless: a wrong token
on a GET used to be waved through, so the extension's setup page reported success for
anything typed into it while the popup — which saves with a POST — went on to fail. A token
you offer must now be the right one, everywhere.

Two routes sit outside the ordinary rules:

- `GET /api/meta` is open to everyone, so a client can ask "are you running?" before it has
  credentials. It reports a version and a driver name, nothing about your data.
- `GET /api/auth/check` is the opposite: **only** a valid token opens it, whatever the
  origin rules would otherwise allow. It exists so "is this token right?" has an answer that
  does not depend on anything else, and it is what the extension calls to confirm a
  connection.
- `POST /api/extension/token` hands out the token, and only to JobTrack's own pages: it needs
  an `Origin` header naming one of them, and neither a missing `Origin` nor the token itself
  opens it. It is a POST because browsers always send `Origin` on one, which is what defeats
  DNS rebinding (a hostile site re-pointing its own hostname at 127.0.0.1, whose GETs would
  otherwise arrive with no `Origin` at all).

### How connecting works

**Connect to JobTrack** opens `GET /connect-extension`, a page JobTrack serves itself, in a new
tab, and injects a small listener into that tab (the extension already has access to
127.0.0.1 and localhost, so this needs no new permission). The page asks you to **Allow**; on
that click it fetches the token from `POST /api/extension/token` and posts it to the listener
with `window.postMessage`, addressed to its own origin only. The extension saves it, confirms
it with `/api/auth/check`, and closes the tab.

Two details keep this narrow. The extension opened the tab and chose its address, so another
local page cannot pose as JobTrack. And the page allows no script or style but its own, pinned
by hash in its `Content-Security-Policy`, and refuses to be framed, so another site cannot put
the Allow button inside its own page.

The token is generated on first run and lives in **`data/api-token`** inside the app data
directory — `%APPDATA%\jobtrack\data\api-token` for a globally installed `jobtrack`, or
`data/api-token` in the repo when running from a clone. Deleting the file makes a new one on
next start; press **Connect to JobTrack** again afterwards.

**Or set `API_TOKEN` in `.env`** (in that same data directory) to choose the token yourself.
That value wins outright and is never written to disk, which also means any `data/api-token`
left over from before is ignored. Connecting hands the extension whichever token is in effect.

---

## The API

```http
GET  /api/auth/check                                  -> { ok: true } | 403
POST /api/ingest/url    { "url": "https://…" }        -> { draft, duplicate }
POST /api/ingest/text   { "text": "…", "url": "…" }   -> { draft, duplicate }
POST /api/ingest/clip   { …draft }                    -> { draft, duplicate, opening } | 409
```

`url` and `text` only parse — they write nothing, so the draft can be shown and corrected
before it becomes a record. `clip` is the one that saves, and it is what the extension
calls.

`clip` answers two different duplicate questions differently, and the difference is the
point. *Another posting from a company you have applied to* is a remark: it saves, and the
`duplicate` verdict comes back so the UI can say so, because applying twice to a company you
like is a reasonable thing to do. *The same posting you already clipped* is a refusal —
`409` with `error: "duplicate_opening"` and a message naming the opening that already holds
it, so pressing Save twice on one tab cannot leave two identical records behind.

The same posting means: the same link, compared after `canonicalJobUrl` strips the scheme,
`www.`, a trailing slash, the fragment and the `utm_…`/`ref` tail that records how you
arrived. Two *different* links are two postings even under one title at one company — the
same role advertised in two cities is two ads. Only when a link is missing on one side does
the company-and-title comparison decide. Archived openings count, converted ones included:
"you already applied to this" is the strongest reason of all not to save a third copy.

Refusal is `clip` only. `POST /api/openings` is somebody typing a record on purpose; a clip
is a button that looks identical whether or not it has already been pressed.

Fetching a URL is capped: `http(s)` only, a 10-second timeout, at most 3 redirects, and 2 MB
of response.

The parsers themselves are in `packages/shared/src/posting.ts` — browser-safe, so the API,
the web app and the extension all run the same code, and a Greenhouse posting produces the
same record whichever route it came in through.
