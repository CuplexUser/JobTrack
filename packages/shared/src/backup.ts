/**
 * Automatic backup settings, shared by the API (which stores and runs them) and the web app
 * (which edits them).
 *
 * These are kept out of `app_settings` on purpose: that table is part of every backup and is
 * replaced on restore, so a schedule stored there would be rolled back by restoring an old
 * backup. The API keeps them in a file of its own instead (see `backup/config-store.ts`).
 */

import { z } from 'zod';

export const BACKUP_FREQUENCIES = ['hourly', 'daily', 'weekly'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

export const BACKUP_ENCRYPTION_MODES = ['none', 'passphrase', 'recipients'] as const;
export type BackupEncryptionMode = (typeof BACKUP_ENCRYPTION_MODES)[number];

/** `HH:mm`, 24-hour, local time. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, for example 02:30');

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** The BIP-173 checksum over a bech32 string's prefix and data; 1 means valid. */
function bech32Polymod(values: number[]): number {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let bit = 0; bit < 5; bit++) if ((top >>> bit) & 1) checksum ^= generator[bit]!;
  }
  return checksum;
}

function isBech32(text: string): boolean {
  const separator = text.lastIndexOf('1');
  if (separator < 1 || text.length - separator - 1 < 6) return false;
  const prefix = text.slice(0, separator);
  const data = Array.from(text.slice(separator + 1), (char) => BECH32_CHARSET.indexOf(char));
  if (data.some((value) => value === -1)) return false;
  const expanded = [...prefix].map((char) => char.charCodeAt(0) >> 5);
  expanded.push(0, ...[...prefix].map((char) => char.charCodeAt(0) & 31));
  return bech32Polymod([...expanded, ...data]) === 1;
}

/**
 * Why a string is not an age recipient, or null when it is one. Checks the bech32 checksum, so
 * a typo, a truncated paste or a made-up `age1…` is caught before it is saved. A pasted secret
 * key gets its own answer: it must never be stored, and saying so is the helpful reply.
 *
 * - `secretKey`: an `AGE-SECRET-KEY-…` or `AGE-PLUGIN-…` identity, the private half.
 * - `notAgeKey`: does not start with `age1` at all.
 * - `invalid`: starts like a key, but is incomplete or mistyped.
 */
export type AgeRecipientProblem = 'secretKey' | 'notAgeKey' | 'invalid';

export function ageRecipientProblem(input: string): AgeRecipientProblem | null {
  const text = input.trim();
  if (/^AGE-(SECRET-KEY|PLUGIN)-/i.test(text)) return 'secretKey';
  // bech32 is either all lower or all upper case, never mixed.
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return 'invalid';
  const lower = text.toLowerCase();
  if (!lower.startsWith('age1')) return 'notAgeKey';
  if (!isBech32(lower)) return 'invalid';
  // A plain X25519 key is always 32 bytes: 52 data characters plus the 6-character checksum.
  if (lower.lastIndexOf('1') === 3 && lower.length !== 4 + 58) return 'invalid';
  return null;
}

const RECIPIENT_MESSAGES: Record<AgeRecipientProblem, string> = {
  secretKey: 'This is a secret key. Add its public key (age1…) instead; a secret key is never stored here',
  notAgeKey: 'This is not an age key. Public keys start with age1',
  invalid: 'This key is incomplete or mistyped. Copy it again from where it was created',
};

/**
 * An age recipient: `age1…` (X25519), `age1pq1…` (post-quantum hybrid), `age1tag1…` (hardware
 * P-256 tag), or `age1<plugin>1…` for a plugin such as `age-plugin-yubikey`. The encoding and
 * checksum are checked here; the API also parses native keys fully before saving.
 */
export const ageRecipientSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    const problem = ageRecipientProblem(value);
    if (problem) context.addIssue({ code: 'custom', message: RECIPIENT_MESSAGES[problem] });
  })
  .transform((value) => value.toLowerCase());

export const backupRecipientSchema = z.object({
  /** What the person calls this key, for example "YubiKey 5C" or "Offline key". */
  label: z.string().trim().max(100).default(''),
  recipient: ageRecipientSchema,
});

export type BackupRecipient = z.output<typeof backupRecipientSchema>;

export const backupScheduleSchema = z.object({
  frequency: z.enum(BACKUP_FREQUENCIES).default('daily'),
  /** Hourly only: hours between backups. */
  everyHours: z.number().int().min(1).max(24).default(6),
  /** Daily and weekly: when the backup runs, local time. */
  time: timeOfDay.default('02:00'),
  /** Weekly only: 0 = Sunday … 6 = Saturday. */
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .default([0])
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
});

export type BackupSchedule = z.output<typeof backupScheduleSchema>;

export const backupRetentionSchema = z.object({
  /** Keep at most this many backups. Null keeps any number. */
  keepLast: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .nullish()
    .transform((v) => (v === undefined ? 14 : v)),
  /** Delete backups older than this. Null keeps them forever. */
  maxAgeDays: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .nullish()
    .transform((v) => (v === undefined ? 90 : v)),
});

export type BackupRetention = z.output<typeof backupRetentionSchema>;

export const backupDestinationSchema = z.object({
  /** Only folders for now; anything synced (OneDrive, Dropbox, a network share) is a folder. */
  kind: z.literal('folder').default('folder'),
  path: z.string().trim().max(1024).default(''),
});

export type BackupDestination = z.output<typeof backupDestinationSchema>;

export const backupEncryptionSchema = z.object({
  mode: z.enum(BACKUP_ENCRYPTION_MODES).default('none'),
  /** Used when `mode` is `recipients`. Any one of them can decrypt a backup on its own. */
  recipients: z.array(backupRecipientSchema).max(20).default([]),
});

export type BackupEncryption = z.output<typeof backupEncryptionSchema>;

const backupConfigObjectSchema = z.object({
  enabled: z.boolean().default(false),
  destination: backupDestinationSchema.default(() => backupDestinationSchema.parse({})),
  schedule: backupScheduleSchema.default(() => backupScheduleSchema.parse({})),
  retention: backupRetentionSchema.default(() => backupRetentionSchema.parse({})),
  /** Skip a scheduled run when nothing has changed since the last backup. */
  skipUnchanged: z.boolean().default(true),
  encryption: backupEncryptionSchema.default(() => backupEncryptionSchema.parse({})),
});

export const backupConfigSchema = backupConfigObjectSchema
  .refine((v) => !v.enabled || v.destination.path !== '', {
    message: 'Choose a folder before turning automatic backups on',
    path: ['destination', 'path'],
  })
  .refine((v) => v.encryption.mode !== 'recipients' || v.encryption.recipients.length > 0, {
    message: 'Add at least one key, or choose another encryption mode',
    path: ['encryption', 'recipients'],
  });

export type BackupConfig = z.output<typeof backupConfigSchema>;

/**
 * Sections left out keep their stored value; a section that is sent replaces the stored one
 * as a whole. The combined checks run on the merged document (see `backup/config-store.ts`).
 *
 * Spelled out rather than `backupConfigObjectSchema.partial()`: in zod 4 a defaulted field
 * stays defaulted under `.partial()`, so a patch of `{ enabled: true }` would come back with
 * every other section reset to its default.
 */
export const backupConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  destination: backupDestinationSchema.optional(),
  schedule: backupScheduleSchema.optional(),
  retention: backupRetentionSchema.optional(),
  skipUnchanged: z.boolean().optional(),
  encryption: backupEncryptionSchema.optional(),
});

export type BackupConfigPatch = z.input<typeof backupConfigPatchSchema>;

/** A passphrase is set, or cleared with null. Never read back. */
export const backupPassphraseSchema = z.object({
  passphrase: z.string().min(8, 'Use at least 8 characters').max(1024).nullable(),
});

export const backupTestSchema = z.object({
  destination: backupDestinationSchema.optional(),
  encryption: backupEncryptionSchema.optional(),
});

export interface BackupRunState {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  /** Null when the last run succeeded (or was skipped). */
  lastError: string | null;
  lastFile: string | null;
  /** The last time a scheduled run found nothing new to back up. */
  lastSkippedAt: string | null;
}

export interface BackupStatus {
  config: BackupConfig;
  /** Whether a passphrase is saved on this machine. The passphrase itself is never sent back. */
  hasPassphrase: boolean;
  state: BackupRunState;
  /** When the next scheduled backup is due. Null when automatic backups are off. */
  nextRunAt: string | null;
}

export interface BackupFile {
  name: string;
  size: number;
  modifiedAt: string;
  encrypted: boolean;
}

export interface BackupRunResult {
  outcome: 'written' | 'skipped';
  file: string | null;
  /** Backups retention removed after this one was written. */
  removed: string[];
}

export interface BackupTestResult {
  ok: boolean;
  /** One line per problem found, empty when everything checked out. */
  problems: string[];
}

export interface GeneratedBackupKey {
  /** The secret key. Shown once and never stored by JobTrack. */
  identity: string;
  recipient: string;
}
