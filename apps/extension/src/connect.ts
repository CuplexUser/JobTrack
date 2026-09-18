/**
 * **Connect to JobTrack**: getting the token without the user copying it out of a file.
 *
 * 1. Ask `GET /api/meta` where the connect page is. A JobTrack older than 1.3.0 does not
 *    report one, and gets told so instead of a tab that goes nowhere.
 * 2. Open that page in a new tab and inject `awaitTokenFromPage` into it.
 * 3. The user presses **Allow** on the page. The page fetches the token (a route only
 *    JobTrack's own pages may call) and posts it to the injected listener.
 * 4. Save it, prove it works with `/api/auth/check`, close the tab.
 *
 * Injection needs no permission the extension did not already have: `host_permissions` names
 * 127.0.0.1 and localhost, which is where the page is. And because the extension opened the
 * tab itself and chose its address, another local page cannot pose as JobTrack here.
 *
 * The page's side is `apps/api/src/routes/extension.routes.ts`; the message names are
 * repeated there. Change both or neither.
 */

import { ext } from './browser-api.js';
import { ApiCallError, callApi, loadSettings, saveSettings, type Settings } from './settings.js';

/** How long the page waits for the user to press Allow before giving up. */
const ALLOW_TIMEOUT_MS = 5 * 60 * 1000;

export type ConnectResult =
  | { ok: true; version: string; token: string }
  | { ok: false; reason: 'unreachable' | 'too-old' | 'closed' | 'timeout' | 'rejected' | 'failed'; message: string };

/**
 * Runs inside the JobTrack tab, in the extension's isolated world. Like `readPage`, it is
 * serialized into the tab, so it has no imports and no free variables beyond its argument.
 *
 * Resolves with the token once the page posts it, or with `null` when nobody presses Allow in
 * time. Both sides say they are there, and each answers the other, because either one may
 * start listening first.
 */
export function awaitTokenFromPage(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const origin = location.origin;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (token: string | null) => {
      window.removeEventListener('message', onMessage);
      if (timer !== undefined) clearTimeout(timer);
      resolve(token);
    };

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== origin) return;
      const data = (event.data ?? {}) as { type?: unknown; token?: unknown };
      if (data.type === 'jobtrack:page-ready') {
        window.postMessage({ type: 'jobtrack:clipper-ready' }, origin);
      } else if (data.type === 'jobtrack:clipper-token' && typeof data.token === 'string' && data.token !== '') {
        window.postMessage({ type: 'jobtrack:clipper-received' }, origin);
        finish(data.token);
      }
    }

    window.addEventListener('message', onMessage);
    timer = setTimeout(() => finish(null), timeoutMs);
    window.postMessage({ type: 'jobtrack:clipper-ready' }, origin);
  });
}

/** Resolves once the tab has finished loading, or rejects if it is closed first. */
function tabLoaded(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanUp = () => {
      ext.tabs.onUpdated.removeListener(onUpdated);
      ext.tabs.onRemoved.removeListener(onRemoved);
    };
    const onUpdated = (updatedId: number, change: { status?: string }) => {
      if (updatedId !== tabId || change.status !== 'complete') return;
      cleanUp();
      resolve();
    };
    const onRemoved = (removedId: number) => {
      if (removedId !== tabId) return;
      cleanUp();
      reject(new Error('closed'));
    };
    ext.tabs.onUpdated.addListener(onUpdated);
    ext.tabs.onRemoved.addListener(onRemoved);

    // It may have finished before the listeners were in place.
    void ext.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') {
          cleanUp();
          resolve();
        }
      },
      () => {
        cleanUp();
        reject(new Error('closed'));
      },
    );
  });
}

export async function connectToJobTrack(baseUrl: string): Promise<ConnectResult> {
  // Connecting only ever changes the address and the token; whatever the location preference
  // was stays as it was, rather than silently resetting to its default on every reconnect.
  const { locationCityOnly } = await loadSettings();

  let meta: { version: string; connectPage?: string };
  try {
    meta = await callApi<{ version: string; connectPage?: string }>({ baseUrl, token: '', locationCityOnly }, '/api/meta');
  } catch (error) {
    return { ok: false, reason: 'unreachable', message: error instanceof Error ? error.message : String(error) };
  }

  if (!meta.connectPage) {
    return {
      ok: false,
      reason: 'too-old',
      message: `JobTrack ${meta.version} cannot connect this way yet. Update JobTrack to 1.3.0 or newer, or enter the token by hand below.`,
    };
  }

  const settingsTab = await ext.tabs.getCurrent();
  const tab = await ext.tabs.create({ url: `${baseUrl}${meta.connectPage}`, active: true });
  const tabId = tab.id;
  if (tabId === undefined) {
    return { ok: false, reason: 'failed', message: 'Could not open the JobTrack page.' };
  }

  let token: string | null;
  try {
    await tabLoaded(tabId);
    const [injection] = await ext.scripting.executeScript({
      target: { tabId },
      func: awaitTokenFromPage,
      args: [ALLOW_TIMEOUT_MS],
    });
    token = injection?.result ?? null;
  } catch {
    return {
      ok: false,
      reason: 'closed',
      message: 'The JobTrack tab was closed or reloaded before the connection was allowed. Press Connect to try again.',
    };
  }

  if (token === null) {
    void ext.tabs.remove(tabId).catch(() => undefined);
    return { ok: false, reason: 'timeout', message: 'Nobody pressed Allow in time. Press Connect to try again.' };
  }

  const settings: Settings = { baseUrl, token, locationCityOnly };
  await saveSettings(settings);

  try {
    await callApi(settings, '/api/auth/check');
  } catch (error) {
    const rejected = error instanceof ApiCallError && error.status === 403;
    return {
      ok: false,
      reason: rejected ? 'rejected' : 'failed',
      message: rejected
        ? 'JobTrack handed over a token it then did not accept. Restart JobTrack and try again.'
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }

  // Leave the user where they started, looking at the result.
  void ext.tabs.remove(tabId).catch(() => undefined);
  if (settingsTab?.id !== undefined) void ext.tabs.update(settingsTab.id, { active: true }).catch(() => undefined);

  return { ok: true, version: meta.version, token };
}
