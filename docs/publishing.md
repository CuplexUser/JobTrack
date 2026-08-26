# Publishing the tray app to npm

`apps/tray` (package name `jobtrack`) is set up to be published standalone, not just run from
a clone of this repo — `npm install -g jobtrack` gets you the full API + web UI + tray icon,
no monorepo in sight.

## How it's wired for this

- `@jobtrack/api` and `@jobtrack/shared` are real (non-private) packages with proper `^x.y.z`
  dependencies between them — `jobtrack` doesn't rely on the workspace-only `*` protocol for
  either, so `npm install -g jobtrack` can resolve them from the registry once they're
  published there too.
- `apps/tray/scripts/stage-assets.mjs` runs automatically as a `prepack` step (`npm pack` /
  `npm publish`): it builds the web UI and copies it, plus `.env.example`, into
  `apps/tray/vendor/` (gitignored — regenerated, never hand-edited), which the package's
  `files` list includes. `src/assets.ts` prefers that bundled copy at runtime and only falls
  back to the sibling `apps/web/dist`/root `.env.example` for local development.
- There's no monorepo once this runs from `node_modules`, so `apps/api/src/config.ts`'s
  `resolveAppDataDir()` points the database, model cache, and active-DB-target pointer at
  `JOBTRACK_HOME` instead of the repo root when that env var is set. `bin/jobtrack.js` — the
  actual `jobtrack` command, as opposed to `npm run tray`'s `tsx src/cli.ts` — sets a sensible
  per-user default (`%APPDATA%\jobtrack` on Windows, `~/.local/share/jobtrack` elsewhere)
  whenever it isn't already set.

## Verifying before you publish

`npm pack` in `packages/shared`, `apps/api`, and `apps/tray` (in that order), then
`npm install` the three `.tgz` files as dependencies in a scratch project outside this repo —
that's a true standalone install, not a workspace symlink.

## Publishing for real

```bash
npm login   # once, if not already

cd packages/shared && npm publish --access public
cd ../../apps/api  && npm publish --access public
cd ../tray         && npm publish --access public   # runs prepack -> stage-assets.mjs
```

Order matters: `apps/api` depends on `@jobtrack/shared`, and `apps/tray` depends on both.

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
  one means a blank npm page. `packages/shared`, `apps/api`, and `apps/tray` each carry one.
- **Versions are immutable.** Once `1.0.0` is published, you can't overwrite it — fixing
  anything metadata-only (a typo'd README, a missing `repository` field) still means bumping
  to `1.0.1` and republishing all three, even though nothing code-level changed.
