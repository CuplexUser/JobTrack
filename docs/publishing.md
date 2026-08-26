# Publishing to npm

`apps/tray` (package name `jobtrack`) and `apps/mcp` (`@jobtrack/mcp`) are both set up to be
published standalone, not just run from a clone of this repo — `npm install -g jobtrack` gets
you the full API + web UI + tray icon, and `npm install -g @jobtrack/mcp` gets you an MCP
server, neither needing a monorepo in sight.

## How it's wired for this

- `@jobtrack/api` and `@jobtrack/shared` are real (non-private) packages with proper `^x.y.z`
  dependencies between them — neither `jobtrack` nor `@jobtrack/mcp` relies on the
  workspace-only `*` protocol for either, so installing them can resolve their dependencies
  from the registry once those are published there too.
- `apps/tray/scripts/stage-assets.mjs` runs automatically as a `prepack` step (`npm pack` /
  `npm publish`): it builds the web UI and copies it, plus `.env.example`, into
  `apps/tray/vendor/` (gitignored — regenerated, never hand-edited), which the package's
  `files` list includes. `src/assets.ts` prefers that bundled copy at runtime and only falls
  back to the sibling `apps/web/dist`/root `.env.example` for local development. `apps/mcp`
  has no such step — it doesn't serve the web UI, so there's nothing to vendor.
- There's no monorepo once either runs from `node_modules`, so `apps/api/src/config.ts`'s
  `resolveAppDataDir()` points the database, model cache, and active-DB-target pointer at
  `JOBTRACK_HOME` instead of the repo root when that env var is set. Both packages' bin
  scripts (`apps/tray/bin/jobtrack.js`, `apps/mcp/bin/jobtrack-mcp.js`) — as opposed to
  `npm run tray`'s `tsx src/cli.ts` / `npm run mcp`'s `tsx src/index.ts` — set the *same*
  sensible per-user default (`%APPDATA%\jobtrack` on Windows, `~/.local/share/jobtrack`
  elsewhere) whenever it isn't already set, so installing both means they share one database
  with zero extra configuration.

## Verifying before you publish

`npm pack` in `packages/shared`, `apps/api`, `apps/mcp`, and `apps/tray` (in that order), then
`npm install` the four `.tgz` files as dependencies in a scratch project outside this repo —
that's a true standalone install, not a workspace symlink.

## Publishing for real

```bash
npm login   # once, if not already

cd packages/shared && npm publish --access public
cd ../../apps/api  && npm publish --access public
cd ../mcp          && npm publish --access public
cd ../tray         && npm publish --access public   # runs prepack -> stage-assets.mjs
```

Order matters: `apps/api` depends on `@jobtrack/shared`; `apps/mcp` and `apps/tray` both
depend on `@jobtrack/api`.

Notes from doing this the first time:

- **`--access public` is required**, not optional, for the two scoped packages
  (`@jobtrack/shared`, `@jobtrack/api`) — npm defaults scoped packages to private/paid
  otherwise. `jobtrack` itself is unscoped and public by default, but passing the flag
  everywhere is harmless.
- **A brand-new scope 404s on first publish.** `npm publish` for `@jobtrack/shared` failed
  with `404 Scope not found` until the `jobtrack` org was created at
  <https://www.npmjs.com/org/create> — npm doesn't auto-create a scope the way it does an
  unscoped package name. Do this once, before the first scoped publish.
- **Each package needs its own `README.md`** sitting in its own directory (not just the repo
  root) — npm renders whatever `README.md` is in the published tarball's root, and a missing
  one means a blank npm page. `packages/shared`, `apps/api`, `apps/mcp`, and `apps/tray` each
  carry one.
- **Versions are immutable.** Once `1.0.0` is published, you can't overwrite it — fixing
  anything metadata-only (a typo'd README, a missing `repository` field) still means bumping
  the version and republishing, even though nothing code-level changed.
