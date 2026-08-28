/**
 * The Windows tray icon: open the UI, toggle autostart, open .env, quit. Built on `systray`
 * (a thin wrapper over a portable Go tray binary), which needs no native compilation — a
 * plain dependency install is enough, unlike node-gyp-based tray libraries.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { resolveWebDist } from './assets.js';
import { APP_VERSION } from './version.js';

// `systray` is CommonJS and sets an `__esModule: true` flag on its own exports while also
// assigning `exports.default`. Node's native ESM/CJS interop does not honor that flag the way
// tsc/webpack do — a plain `import SysTray from 'systray'` resolves to the *whole*
// `module.exports` object (which itself has a `.default`), one level up from the real class,
// so `new SysTray(...)` fails with "SysTray is not a constructor". Going through `require`
// directly sidesteps that ESM-interop ambiguity and gets the real class, as plain CommonJS
// consumption always would.
type SysTrayCtor = typeof import('systray').default;
const SysTray = createRequire(import.meta.url)('systray').default as SysTrayCtor;

/**
 * Positions in the `items` array below — `systray` identifies a clicked item by its index,
 * so these must be kept in step with that array's order.
 */
const ITEM = { VERSION: 0, OPEN: 1, AUTOSTART: 2, SETTINGS: 3, QUIT: 4 } as const;

export interface TrayHandlers {
  autostartEnabled: boolean;
  onOpen: () => void;
  onToggleAutostart: (nextEnabled: boolean) => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

export function createTray(handlers: TrayHandlers): InstanceType<SysTrayCtor> {
  const webDist = resolveWebDist();
  if (!webDist) {
    throw new Error('No built web UI found — run "npm run build" before starting the tray.');
  }
  const icon = readFileSync(resolve(webDist, 'favicon.ico')).toString('base64');

  const systray = new SysTray({
    menu: {
      icon,
      title: 'JobTrack',
      tooltip: `JobTrack v${APP_VERSION} is running`,
      items: [
        // Disabled on purpose: a label, not an action. It heads the menu so the version is
        // the first thing visible on right-click, without having to hover for the tooltip.
        {
          title: `JobTrack v${APP_VERSION}`,
          tooltip: 'The installed version of the jobtrack package',
          checked: false,
          enabled: false,
        },
        { title: 'Open JobTrack', tooltip: 'Open the web UI', checked: false, enabled: true },
        {
          title: 'Autostart with Windows',
          tooltip: 'Launch JobTrack automatically when you sign in',
          checked: handlers.autostartEnabled,
          enabled: true,
        },
        { title: 'Open App Settings', tooltip: 'Edit .env', checked: false, enabled: true },
        { title: 'Quit', tooltip: 'Stop JobTrack', checked: false, enabled: true },
      ],
    },
    debug: false,
    // Copies the bundled Go tray binary out of node_modules before running it — needed for
    // packaging tools (and harmless otherwise), per the systray README.
    copyDir: true,
  });

  systray.onClick((action) => {
    switch (action.seq_id) {
      case ITEM.OPEN:
        handlers.onOpen();
        break;
      case ITEM.AUTOSTART: {
        const next = !action.item.checked;
        handlers.onToggleAutostart(next);
        systray.sendAction({
          type: 'update-item',
          item: { ...action.item, checked: next },
          seq_id: action.seq_id,
        });
        break;
      }
      case ITEM.SETTINGS:
        handlers.onOpenSettings();
        break;
      case ITEM.QUIT:
        handlers.onQuit();
        break;
      default:
        break;
    }
  });

  return systray;
}
