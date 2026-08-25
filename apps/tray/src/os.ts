/**
 * Small platform-shell helpers. The tray icon itself (see tray.ts) is Windows-only for now,
 * but these stay cross-platform so running headless on macOS/Linux still gets a working
 * "open the app" experience.
 */
import { execFile } from 'node:child_process';

export function openUrl(url: string): void {
  if (process.platform === 'win32') {
    // The empty string is `start`'s window-title argument — required so it doesn't mistake
    // a quoted URL for the title itself.
    execFile('cmd', ['/c', 'start', '""', url]);
  } else if (process.platform === 'darwin') {
    execFile('open', [url]);
  } else {
    execFile('xdg-open', [url]);
  }
}

export function openInEditor(filePath: string): void {
  if (process.platform === 'win32') {
    execFile('notepad.exe', [filePath]);
  } else if (process.platform === 'darwin') {
    execFile('open', ['-t', filePath]);
  } else {
    execFile('xdg-open', [filePath]);
  }
}
