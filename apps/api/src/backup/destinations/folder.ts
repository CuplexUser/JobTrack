/**
 * A backup folder: a local path, a mapped drive, a UNC share, or a folder a sync client
 * (OneDrive, Dropbox, …) uploads for us.
 *
 * Each file is written under a `.partial` name and renamed once complete, so a sync client
 * never uploads half a backup and retention never mistakes one for a real backup. The file is
 * then read back and compared, since a network share that silently truncates is exactly the
 * failure nobody notices until they need the backup.
 */

import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseBackupFileName } from '../schedule.js';
import type { Destination, StoredBackup } from './index.js';

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function describe(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return 'The folder does not exist, or is not reachable right now';
  if (code === 'EACCES' || code === 'EPERM') return 'JobTrack is not allowed to write to this folder';
  if (code === 'ENOSPC') return 'There is not enough free space in this folder';
  return error instanceof Error ? error.message : String(error);
}

export class FolderDestination implements Destination {
  readonly #folder: string;

  constructor(folder: string) {
    this.#folder = folder;
  }

  #path(name: string): string {
    // Only names JobTrack generated ever reach here, but a path separator would still be a bug.
    if (/[\\/]/.test(name)) throw new Error(`Invalid backup name: ${name}`);
    return join(this.#folder, name);
  }

  async #checkFolder(): Promise<void> {
    if (this.#folder.trim() === '') throw new Error('No backup folder is set');
    if (!isAbsolute(this.#folder)) throw new Error('Use a full path for the backup folder, for example C:\\Users\\you\\OneDrive\\Backups');
    let info;
    try {
      info = await stat(this.#folder);
    } catch (error) {
      throw new Error(describe(error));
    }
    if (!info.isDirectory()) throw new Error('This path is a file, not a folder');
  }

  async test(): Promise<void> {
    await this.#checkFolder();
    const probe = this.#path(`.jobtrack-write-test-${randomBytes(4).toString('hex')}`);
    try {
      const handle = await open(probe, 'w');
      await handle.writeFile('ok');
      await handle.close();
    } catch (error) {
      throw new Error(describe(error));
    } finally {
      await rm(probe, { force: true }).catch(() => undefined);
    }
  }

  async write(name: string, data: Uint8Array): Promise<void> {
    await this.#checkFolder();
    const final = this.#path(name);
    const partial = `${final}.partial`;
    try {
      const handle = await open(partial, 'w');
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(partial, final);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      throw new Error(describe(error));
    }

    const written = await readFile(final);
    if (sha256(written) !== sha256(data)) {
      await rm(final, { force: true }).catch(() => undefined);
      throw new Error('The backup file did not read back correctly, so it was removed');
    }
  }

  async list(): Promise<StoredBackup[]> {
    await this.#checkFolder();
    const entries = await readdir(this.#folder, { withFileTypes: true });
    const backups: StoredBackup[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !parseBackupFileName(entry.name)) continue;
      const info = await stat(this.#path(entry.name));
      backups.push({ name: entry.name, size: info.size, modifiedAt: info.mtime });
    }
    return backups.sort((a, b) => b.name.localeCompare(a.name));
  }

  async remove(name: string): Promise<void> {
    if (!parseBackupFileName(name)) throw new Error(`Refusing to delete ${name}: JobTrack did not write it`);
    await rm(this.#path(name), { force: true });
  }
}
