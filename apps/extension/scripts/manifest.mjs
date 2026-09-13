/**
 * The extension's manifest, built per browser.
 *
 * One definition, two flavors. Chromium browsers and Firefox read the same Manifest V3 keys for
 * everything this extension does; Firefox additionally needs `browser_specific_settings`,
 * which Chromium reports as an unrecognized key. So the Chromium manifest (`dist/`, for loading
 * unpacked while developing) leaves it out, and the Firefox one (`release/firefox/`, what
 * Mozilla signs) adds it.
 *
 * The version always comes from `package.json`, so there is one number to bump.
 */

/**
 * The add-on's permanent identity at Mozilla. Signing ties every future version to it, and
 * installed copies only accept updates carrying the same id: **never change it.**
 */
export const GECKO_ID = 'jobtrack-clipper@cuplexuser';

/**
 * Where installed copies look for new versions. Written by the GitHub Pages deploy
 * (`.github/workflows/demo.yml`, via `scripts/firefox-updates.mjs`) from the latest signed
 * release. Firefox requires HTTPS here.
 */
export const FIREFOX_UPDATE_URL = 'https://cuplexuser.github.io/JobTrack/clipper/updates.json';

/**
 * Firefox 140 is the first to read `data_collection_permissions`, which Mozilla now requires
 * of new add-ons. It is also an ESR release, so nobody on a supported Firefox is left out.
 */
export const FIREFOX_MIN_VERSION = '140.0';

/** Firefox for Android reads `data_collection_permissions` from 142, two releases later. */
export const FIREFOX_ANDROID_MIN_VERSION = '142.0';

/**
 * @param {'chromium' | 'firefox'} target
 * @param {string} version
 */
export function buildManifest(target, version) {
  const manifest = {
    manifest_version: 3,
    name: 'JobTrack Clipper',
    version,
    description: 'Save the job posting you are looking at into your local JobTrack.',
    permissions: ['activeTab', 'scripting', 'storage'],
    host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],
    action: {
      default_popup: 'popup.html',
      default_title: 'Save to JobTrack',
    },
    // A full tab rather than an embedded panel: connecting opens JobTrack in a tab next to it
    // and comes back to report the result.
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    icons: {
      16: 'icon-16.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
  };

  if (target === 'chromium') return manifest;

  return {
    ...manifest,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        update_url: FIREFOX_UPDATE_URL,
        // Postings go to JobTrack on the user's own machine and to nobody else: no developer
        // server, no analytics. This is a judgment call against Mozilla's wording ("handled
        // outside the add-on or the local browser"); if review disagrees, the honest
        // alternative is `required: ['websiteContent']`, which shows a line in the install
        // prompt and changes nothing else.
        data_collection_permissions: {
          required: ['none'],
        },
      },
      gecko_android: {
        strict_min_version: FIREFOX_ANDROID_MIN_VERSION,
      },
    },
  };
}
