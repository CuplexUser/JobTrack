/**
 * The seam between the real API and the client-side demo.
 *
 * Every other file in `apps/web` imports `api` from here (not from `client.js` directly),
 * so which implementation is live is decided in exactly one place: `VITE_DEMO`, set by the
 * `build:demo` script (see `.env.demo`). Everything else — types, `ApiError`, `toQuery` —
 * still comes straight from `client.js`.
 */

import { httpApi } from './client.js';
import { demoApi } from './demo-client.js';

export * from './client.js';

export const api = import.meta.env.VITE_DEMO === 'true' ? demoApi : httpApi;
