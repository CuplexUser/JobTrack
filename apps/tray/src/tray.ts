/**
 * The Windows tray icon: open the UI, toggle autostart, open .env, quit. Built on `systray`
 * (a thin wrapper over a portable Go tray binary), which needs no native compilation — a
 * plain dependency install is enough, unlike node-gyp-based tray libraries.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { repoRoot } from '@jobtrack/api/config';

// `systray` is CommonJS and sets an `__esModule: true` flag on its own exports while also
// assigning `exports.default`. Node's native ESM/CJS interop does not honor that flag the way
// tsc/webpack do — a plain `import SysTray from 'systray'` resolves to the *whole*
// `module.exports` object (which itself has a `.default`), one level up from the real class,
// so `new SysTray(...)` fails with "SysTray is not a constructor". Going through `require`
// directly sidesteps that ESM-interop ambiguity and gets the real class, as plain CommonJS
// consumption always would.
type SysTrayCtor = typeof import('systray').default;
const SysTray = createRequire(import.meta.url)('systray').default as SysTrayCtor;

// Reuses the web app's own favicon rather than shipping a second copy of the icon artwork.
const iconPath = resolve(repoRoot, 'apps/web/public/favicon.ico');

const ITEM = { OPEN: 0, AUTOSTART: 1, SETTINGS: 2, QUIT: 3 } as const;

export interface TrayHandlers {
  autostartEnabled: boolean;
  onOpen: () => void;
  onToggleAutostart: (nextEnabled: boolean) => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

export function createTray(handlers: TrayHandlers): InstanceType<SysTrayCtor> {
  const icon = readFileSync(iconPath).toString('base64');

  const systray = new SysTray({
    menu: {
      icon,
      title: 'JobTrack',
      tooltip: 'JobTrack is running',
      items: [
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
