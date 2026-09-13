/**
 * The extension API, whichever browser this is running in.
 *
 * Firefox's API lives at `browser` and returns promises. Chromium browsers put it at `chrome`,
 * promise-based under Manifest V3, and recent ones add `browser` as well. Everything this
 * extension calls has the same shape under both names, so one reference covers every browser
 * without a polyfill.
 *
 * Use `ext` everywhere instead of `chrome` directly, so the next API call added cannot quietly
 * be the one that only works in Chromium.
 */

const scope = globalThis as unknown as { browser?: typeof chrome; chrome?: typeof chrome };

/** Read off `globalThis` rather than named directly, so importing this outside a browser (a test) does not throw. */
export const ext = (scope.browser ?? scope.chrome) as typeof chrome;

/**
 * Where JobTrack runs, as match patterns. The same list as `host_permissions` in the manifest;
 * a match pattern without a port matches every port.
 */
export const JOBTRACK_ORIGINS = ['http://127.0.0.1/*', 'http://localhost/*'];

/**
 * Whether the extension may talk to JobTrack.
 *
 * Chromium grants `host_permissions` for good at install. Firefox grants them at install too
 * (from Firefox 127), but lets the user take them away again from the add-on's Permissions
 * tab, after which every request to JobTrack fails as if it were not running.
 */
export async function canReachJobTrack(): Promise<boolean> {
  try {
    return await ext.permissions.contains({ origins: JOBTRACK_ORIGINS });
  } catch {
    // An API that is not there cannot have been restricted either.
    return true;
  }
}

/**
 * Ask for access to JobTrack again. Firefox only shows the prompt when this is called straight
 * from a click handler, so call it before the handler awaits anything else.
 */
export async function requestJobTrackAccess(): Promise<boolean> {
  try {
    return await ext.permissions.request({ origins: JOBTRACK_ORIGINS });
  } catch {
    return false;
  }
}

/** What to tell someone whose browser has the extension cut off from JobTrack. */
export const NO_ACCESS_MESSAGE =
  'JobTrack Clipper is not allowed to reach JobTrack on this computer. Allow it when asked, or turn on access to 127.0.0.1 and localhost on the add-on’s Permissions tab.';
