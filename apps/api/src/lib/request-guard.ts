/**
 * Who is allowed to call this API.
 *
 * The threat is specific and worth naming, because the rules below only make sense against
 * it: a single-user server bound to 127.0.0.1 is not reachable from the internet, but it
 * *is* reachable from every page loaded in the browser running on the same machine. With a
 * reflecting CORS policy and no authentication, any site you visit could quietly POST
 * applications into your tracker, or read every one back out.
 *
 * Three rules, in order:
 *
 * 0. **A token that is presented and wrong** — refused, before anything else is considered.
 * 1. **No `Origin` header** — allowed. That is a non-browser caller: curl, the MCP server,
 *    the tray's own process. It does mean any *local process* can call the API, which is
 *    already true of the SQLite file it sits on.
 * 2. **A known origin** — allowed. The tray's own address, the Vite dev server, and
 *    anything the user listed in `CORS_ORIGINS`.
 * 3. **Anything else** — needs the token, which is how the browser extension gets in: its
 *    `chrome-extension://<id>` origin is not knowable until it is installed.
 *
 * Rule 1 deserves its caveat stated plainly, because it is narrower than it looks. Browsers
 * send `Origin` on cross-origin POSTs (form posts included) but **not on GETs** — so the
 * exemption does cover a hostile page's cross-origin GET. That page still cannot read the
 * reply: without CORS headers the response is opaque to it, and JSON is not valid script,
 * so there is no `<script src>` trick either. What it cannot be used for is *writing*,
 * which is the thing worth protecting here. Rule 0 exists because that same exemption made
 * credential checks meaningless.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';

/**
 * Open even to an unknown origin: the tray, the extension's options page and any health
 * check need a way to ask "is JobTrack running, and which build?" before they have a token.
 * It reports a version and a driver name — nothing about the data.
 */
const PUBLIC_PATHS = new Set(['/api/meta']);

/**
 * The opposite: a route that *only* a valid token opens, whatever the origin rules would
 * otherwise say. There is exactly one, and it exists so "is this token right?" has an
 * answer that does not depend on anything else.
 *
 * Without it the question is unanswerable, and was answered wrongly: browsers omit `Origin`
 * on a GET, so a connection test done with one sailed through the "no Origin, therefore not
 * a browser" rule and reported success for any string in the box — including an empty one.
 */
const TOKEN_ONLY_PATHS = new Set(['/api/auth/check']);

export interface GuardOptions {
  allowedOrigins: readonly string[];
  token: string;
}

/** Case- and trailing-slash-insensitive, since browsers are not consistent about either. */
function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, '');
}

export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return true; // Not a browser — rule 1.
  const normalized = normalizeOrigin(origin);
  return allowed.some((entry) => normalizeOrigin(entry) === normalized);
}

/** Constant-time-ish comparison. The token is not a password, but leaking it a byte at a time is still avoidable. */
function tokenMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** `Authorization: Bearer <token>`, or the header the extension finds easier to set. */
function presentedToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const header = request.headers['x-jobtrack-token'];
  if (typeof header === 'string' && header.trim() !== '') return header.trim();
  return null;
}

export function registerRequestGuard(app: FastifyInstance, options: GuardOptions): void {
  app.addHook('onRequest', async (request) => {
    // Only the API is guarded; the tray serves the SPA's own assets from the same server.
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;
    // Preflight is answered by @fastify/cors, which is registered ahead of this hook.
    if (request.method === 'OPTIONS') return;
    if (PUBLIC_PATHS.has(path)) return;

    const presented = presentedToken(request);
    const tokenOk = presented !== null && tokenMatches(presented, options.token);

    // A token that is offered and wrong is a refusal, whatever the origin would have said.
    // Presenting credentials is a claim about who you are; letting a bad one through on the
    // grounds that the request would have been allowed anonymously makes "is my token
    // right?" unanswerable — and answered it wrongly for every GET.
    if (presented !== null && !tokenOk) {
      throw new HttpError(403, 'That is not this server’s API token.', undefined, 'bad_token');
    }

    if (TOKEN_ONLY_PATHS.has(path)) {
      if (tokenOk) return;
      throw new HttpError(403, 'This route needs the API token.', undefined, 'bad_token');
    }

    if (isAllowedOrigin(request.headers.origin, options.allowedOrigins)) return;
    if (tokenOk) return;

    throw new HttpError(
      403,
      'This origin is not allowed to use the JobTrack API. A browser extension needs its token — see docs/capture.md.',
    );
  });
}
