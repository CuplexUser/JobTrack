/**
 * Where the extension keeps the two things it needs to reach JobTrack.
 *
 * The token is the reason the API lets an extension in at all: its
 * `chrome-extension://<id>` origin is not on any allowlist and cannot be, because the id is
 * not knowable until the extension is installed. See `apps/api/src/lib/request-guard.ts`.
 */

export interface Settings {
  /** The API's address, e.g. http://127.0.0.1:3001 — no trailing slash. */
  baseUrl: string;
  token: string;
}

/** The tray's default bind address, which is where JobTrack is for nearly everyone. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(['baseUrl', 'token']);
  return {
    baseUrl: typeof stored.baseUrl === 'string' && stored.baseUrl ? stored.baseUrl : DEFAULT_BASE_URL,
    token: typeof stored.token === 'string' ? stored.token : '',
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({
    baseUrl: settings.baseUrl.replace(/\/+$/, ''),
    token: settings.token.trim(),
  });
}

export class ApiCallError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * One call, with the token attached.
 *
 * CORS never comes into it: `host_permissions` in the manifest names the local API, and
 * Chrome grants an extension page direct access to hosts it has permission for. The token
 * is what the *server* checks.
 */
export async function callApi<T>(settings: Settings, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiCallError(0, `Could not reach JobTrack at ${settings.baseUrl}. Is it running?`);
  }

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : response.statusText;
    throw new ApiCallError(response.status, message);
  }
  return parsed as T;
}
