/**
 * Connecting the browser extension without copying the token by hand.
 *
 * The extension's settings page has a **Connect to JobTrack** button. It opens
 * `GET /connect-extension` in a new tab and listens on that tab for one message. The page asks
 * the user to allow the connection; on **Allow** it fetches the token from
 * `POST /api/extension/token` and posts it to the listening extension with `window.postMessage`.
 *
 * Why this shape:
 *
 * - **The server serves the page itself** rather than the web app routing to it, so it works
 *   wherever the API runs: the tray, a standalone `jobtrack`, and `npm run dev`'s API on 3002,
 *   which serves no web UI at all.
 * - **The token route is for this app's own pages only** (`OWN_PAGE_ONLY_PATHS` in
 *   `lib/request-guard.ts`). A page on any other site cannot read it.
 * - **A person presses Allow.** The extension could be the one to ask, but then connecting
 *   would be something that happens to the user rather than something they do.
 * - **Messages go to this page's own origin only** (`postMessage(message, location.origin)`),
 *   so nothing framed or opened from elsewhere hears the token. `frame-ancestors 'none'` keeps
 *   the Allow button from being framed by another site to begin with.
 *
 * The message names are repeated in `apps/extension/src/connect.ts`. Change both or neither.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';

/** Where the page lives. `GET /api/meta` reports it, which is how the extension knows this server has one. */
export const CONNECT_PAGE_PATH = '/connect-extension';

const STYLE = `
:root { color-scheme: light dark; --bg:#ffffff; --sunken:#f6f8fa; --border:#d0d7de; --text:#1f2328; --muted:#656d76; --accent:#0969da; --danger:#d1242f; --success:#1a7f37; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --sunken:#161b22; --border:#30363d; --text:#e6edf3; --muted:#8b949e; --accent:#58a6ff; --danger:#f85149; --success:#3fb950; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 48px 16px; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
main { max-width: 460px; margin: 0 auto; padding: 24px; border: 1px solid var(--border); border-radius: 10px; background: var(--sunken); }
h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
p { margin: 0 0 12px; }
.muted { color: var(--muted); font-size: 13px; }
button { margin-top: 8px; padding: 8px 18px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent); color: #ffffff; font: inherit; font-weight: 500; cursor: pointer; }
button:disabled { opacity: 0.55; cursor: default; }
#status { margin-top: 16px; }
#status.error { color: var(--danger); }
#status.ok { color: var(--success); }
`;

const SCRIPT = `
(() => {
  const origin = location.origin;
  const allow = document.getElementById('allow');
  const status = document.getElementById('status');
  let extensionListening = false;

  const say = (text, kind) => {
    status.textContent = text;
    status.className = kind || '';
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== origin) return;
    const data = event.data || {};
    if (data.type === 'jobtrack:clipper-ready') {
      extensionListening = true;
      allow.disabled = false;
      say('', '');
    } else if (data.type === 'jobtrack:clipper-received') {
      allow.disabled = true;
      say('Connected. The extension will close this tab.', 'ok');
    }
  });

  // The extension may start listening before or after this runs, so both sides announce
  // themselves and each answers the other.
  window.postMessage({ type: 'jobtrack:page-ready' }, origin);

  setTimeout(() => {
    if (!extensionListening) {
      say('No extension is waiting for this page. Open JobTrack Clipper\\u2019s settings and press Connect to JobTrack; it opens this page for you.', 'error');
    }
  }, 3000);

  allow.addEventListener('click', async () => {
    allow.disabled = true;
    say('Connecting\\u2026', '');
    try {
      const response = await fetch('/api/extension/token', { method: 'POST' });
      if (!response.ok) throw new Error('JobTrack answered ' + response.status);
      const { token } = await response.json();
      window.postMessage({ type: 'jobtrack:clipper-token', token }, origin);
    } catch (error) {
      allow.disabled = false;
      say('Could not get the token: ' + (error && error.message ? error.message : error), 'error');
    }
  });
})();
`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect JobTrack Clipper</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <h1>Connect JobTrack Clipper</h1>
  <p>The JobTrack Clipper browser extension is asking to save job postings into JobTrack on this computer.</p>
  <p class="muted">Allow it only if you just pressed <strong>Connect to JobTrack</strong> in the extension's settings. You can undo this at any time by removing the extension.</p>
  <button id="allow" type="button" disabled>Allow</button>
  <p id="status" role="status"></p>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

/**
 * Nothing loads from anywhere, and the only script and style that run are the two above,
 * pinned by hash rather than allowed wholesale with `'unsafe-inline'`.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `script-src ${sha256(SCRIPT)}`,
  `style-src ${sha256(STYLE)}`,
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export async function extensionRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get(CONNECT_PAGE_PATH, async (_request, reply) =>
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .send(PAGE),
  );

  /** Only reachable from this app's own pages; see `OWN_PAGE_ONLY_PATHS` in the request guard. */
  app.post('/api/extension/token', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { token: deps.config.apiToken };
  });
}
