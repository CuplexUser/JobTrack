/**
 * Where automatic backups go. A folder is the only kind today, and it covers more than it
 * sounds like: OneDrive, Dropbox, Google Drive and iCloud all sync a folder, and a network
 * share is a folder too. WebDAV, S3 or SFTP would be further implementations of this same
 * interface, chosen by `destination.kind`.
 */

import type { BackupDestination } from '@jobtrack/shared';
import { FolderDestination } from './folder.js';

export interface StoredBackup {
  name: string;
  size: number;
  modifiedAt: Date;
}

export interface Destination {
  /** Resolves when the destination can be written to; throws with a readable reason otherwise. */
  test(): Promise<void>;
  /** Writes the whole file or nothing, and checks what landed. */
  write(name: string, data: Uint8Array): Promise<void>;
  /** Only backups JobTrack wrote; anything else in the same place is not listed. */
  list(): Promise<StoredBackup[]>;
  remove(name: string): Promise<void>;
}

export function openDestination(config: BackupDestination): Destination {
  switch (config.kind) {
    case 'folder':
      return new FolderDestination(config.path);
  }
}
