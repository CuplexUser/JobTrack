# JobTrack Clipper

The browser extension that saves the job posting you are reading into JobTrack. What it does
and how to install it are in [`docs/capture.md`](../../docs/capture.md); its privacy policy is
[`PRIVACY.md`](PRIVACY.md).

## Building from source

This is also what Mozilla's reviewers need to reproduce the signed package. From the repository
root, with Node.js 24 or newer:

```bash
npm ci
npm run build --workspace=@jobtrack/shared
npm run package --workspace=@jobtrack/extension
```

That writes `apps/extension/release/`:

| | |
|---|---|
| `firefox/` | the unpacked Firefox add-on, the folder that is signed |
| `jobtrack-clipper-<version>-firefox.zip` | the same, zipped |
| `jobtrack-clipper-<version>-chromium.zip` | the Chromium build, for a future store listing |

`src/` is TypeScript, bundled by Vite (`vite.config.ts`) without minification. The manifest is
generated per browser by `scripts/manifest.mjs`, with the version from `package.json`, and the
zips are written by `scripts/zip.mjs` with fixed timestamps, so packaging the same commit twice
gives the same bytes. The code it imports from `packages/shared` is JobTrack's own posting parser.

## Developing

- `npm run dev --workspace=@jobtrack/extension` rebuilds `dist/` on every change.
- **Firefox:** `about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick
  `release/firefox/manifest.json` after `npm run package`. Temporary add-ons are removed when
  Firefox closes.
- **Chrome or Edge:** **Extensions** → **Developer mode** → **Load unpacked** → `dist/`.
- `npm test -- --project extension` runs the packaging tests.

## Releasing

Bump `version` in this folder's `package.json` and push to main. See
[`docs/publishing.md`](../../docs/publishing.md#the-firefox-add-on).
