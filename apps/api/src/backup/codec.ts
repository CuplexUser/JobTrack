/**
 * Wire format for a backup: minified JSON, gzip-compressed, then obfuscated. Node's built-in
 * `zlib` and `crypto` — no new dependency for something this small.
 *
 * The obfuscation step is a fixed-keystream XOR — **not encryption**, and deliberately not
 * described as such anywhere in the UI. There is no passphrase, and the "key" is derived from
 * a constant baked into this file, so anyone who has (or guesses) this source can reverse it
 * in a few lines. All it buys is that the file isn't plain, grep-able JSON if it's opened in a
 * text editor or glanced at in a hex viewer — it does not protect the personal data inside
 * (salaries, notes, company names) from anyone who actually wants it.
 *
 * Real encryption is a separate, optional layer on top: `crypto.ts` wraps this exact output
 * in age, so a decrypted `.jtbak.age` is an ordinary `.jtbak` again. `decodeBackup` accepts
 * either kind.
 */

import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { badRequest } from '../lib/errors.js';
import { decryptBackup, isAgeEncrypted, type DecryptionSecrets } from './crypto.js';
import type { BackupSnapshot } from './snapshot.js';

/** Not a secret. Only long enough that the repeating pattern isn't obvious at a glance. */
const KEYSTREAM = createHash('sha256').update('jobtrack-backup-obfuscation-v1').digest();

function xor(buffer: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    out[i] = buffer[i]! ^ KEYSTREAM[i % KEYSTREAM.length]!;
  }
  return out;
}

export function encodeSnapshot(snapshot: BackupSnapshot): Buffer {
  // No `space` argument to `JSON.stringify` — this is the "minified" half; gzip is the
  // "compressed" half; xor is the "obfuscated" half.
  const gzipped = gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'));
  return xor(gzipped);
}

export function decodeSnapshot(buffer: Buffer): unknown {
  try {
    return JSON.parse(gunzipSync(xor(buffer)).toString('utf8'));
  } catch {
    throw badRequest('This file is not a JobTrack backup');
  }
}

/** Opens a `.jtbak` or an age-encrypted `.jtbak.age`, decrypting it with `secrets` first when needed. */
export async function decodeBackup(buffer: Buffer, secrets: DecryptionSecrets = {}): Promise<unknown> {
  return decodeSnapshot(isAgeEncrypted(buffer) ? await decryptBackup(buffer, secrets) : buffer);
}
