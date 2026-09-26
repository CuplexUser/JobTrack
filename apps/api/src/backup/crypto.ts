/**
 * Real encryption for backups, using the age format (https://age-encryption.org) through
 * typage (`age-encryption`).
 *
 * The plaintext inside the age envelope is exactly what `codec.ts`'s `encodeSnapshot` writes,
 * so `age -d backup.jtbak.age > backup.jtbak` gives a file the ordinary Restore accepts. That
 * is the way back in if JobTrack itself is ever gone: the backups do not depend on it.
 *
 * A backup can be encrypted to a passphrase, or to any number of public keys: native X25519
 * and post-quantum keys (`age1…`, `age1pq1…`), hardware P-256 tag keys (`age1tag1…`), and
 * plugin keys such as `age1yubikey1…` (see `plugin-recipient.ts`). With public keys, nothing
 * stored on this machine can decrypt the backups it writes.
 */

import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { HttpError, badRequest } from '../lib/errors.js';
import { PluginRecipient, pluginNameOf, type PluginLauncher } from './plugin-recipient.js';

const AGE_MAGIC = Buffer.from('age-encryption.org/v1\n', 'utf8');

/** Whether a file is age-encrypted, judged by its header line alone. */
export function isAgeEncrypted(buffer: Uint8Array): boolean {
  return buffer.length >= AGE_MAGIC.length && Buffer.from(buffer.subarray(0, AGE_MAGIC.length)).equals(AGE_MAGIC);
}

export type EncryptionKeys =
  | { kind: 'passphrase'; passphrase: string }
  | { kind: 'recipients'; recipients: string[] };

export interface CryptoOptions {
  /** How plugin binaries are started. Tests swap in a fake plugin. */
  launch?: PluginLauncher;
  /** scrypt work factor for passphrase encryption. Only tests lower it. */
  scryptWorkFactor?: number;
}

function addRecipient(encrypter: Encrypter, recipient: string, options: CryptoOptions): void {
  if (pluginNameOf(recipient)) encrypter.addRecipient(new PluginRecipient(recipient, { launch: options.launch }));
  else encrypter.addRecipient(recipient);
}

export async function encryptBackup(plaintext: Uint8Array, keys: EncryptionKeys, options: CryptoOptions = {}): Promise<Buffer> {
  const encrypter = new Encrypter();
  if (keys.kind === 'passphrase') {
    if (options.scryptWorkFactor !== undefined) encrypter.setScryptWorkFactor(options.scryptWorkFactor);
    encrypter.setPassphrase(keys.passphrase);
  } else {
    if (keys.recipients.length === 0) throw new Error('No keys to encrypt the backup to');
    for (const recipient of keys.recipients) addRecipient(encrypter, recipient, options);
  }
  return Buffer.from(await encrypter.encrypt(plaintext));
}

/**
 * Checks a recipient without encrypting anything: native keys are parsed, plugin keys need
 * their plugin to be installed, so that is tried with a throwaway file key.
 */
export async function checkRecipient(recipient: string, options: CryptoOptions = {}): Promise<string | null> {
  try {
    if (pluginNameOf(recipient)) {
      await new PluginRecipient(recipient, { launch: options.launch }).wrapFileKey(new Uint8Array(16));
    } else {
      new Encrypter().addRecipient(recipient);
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export interface DecryptionSecrets {
  passphrase?: string | undefined;
  /** The contents of an identity file: `AGE-SECRET-KEY-…` lines, comments allowed. */
  identity?: string | undefined;
}

/** The secret keys in an identity file, skipping comments and blank lines. */
export function parseIdentities(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export async function decryptBackup(buffer: Uint8Array, secrets: DecryptionSecrets): Promise<Buffer> {
  const decrypter = new Decrypter();
  let any = false;

  if (secrets.passphrase) {
    decrypter.addPassphrase(secrets.passphrase);
    any = true;
  }
  for (const identity of parseIdentities(secrets.identity ?? '')) {
    if (identity.startsWith('AGE-PLUGIN-')) {
      throw badRequest(
        'Hardware and plugin keys cannot unlock a backup here. Decrypt it with the age command line tool first, then restore the decrypted file.',
      );
    }
    try {
      decrypter.addIdentity(identity);
    } catch {
      throw badRequest('That secret key is not valid. It should start with AGE-SECRET-KEY-.');
    }
    any = true;
  }
  // A distinct code, so the restore dialog can ask for a key instead of just showing an error.
  if (!any) throw new HttpError(400, 'This backup is encrypted. Enter its passphrase or secret key to open it.', undefined, 'backup_encrypted');

  try {
    return Buffer.from(await decrypter.decrypt(buffer));
  } catch {
    throw new HttpError(400, 'Could not decrypt this backup. Check the passphrase or secret key.', undefined, 'backup_decrypt_failed');
  }
}

export interface GeneratedKey {
  identity: string;
  recipient: string;
}

export async function generateKey(): Promise<GeneratedKey> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}
