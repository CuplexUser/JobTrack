/**
 * When automatic backups are due, what they are called, and which old ones retention removes.
 * Pure functions over dates, so every rule here is testable without a clock or a disk.
 *
 * Schedules are in local time, since "every night at 02:00" means the person's night. A run
 * that was missed (the computer was off at 02:00) is due as soon as the app is running again,
 * rather than waiting a whole day for the next slot.
 */

import type { BackupRetention, BackupRunState, BackupSchedule } from '@jobtrack/shared';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** After a failed run, wait this long before trying again, so a missing folder is not retried every few minutes. */
export const RETRY_AFTER_FAILURE_MS = HOUR;

function atTime(day: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  const slot = new Date(day);
  slot.setHours(hours, minutes, 0, 0);
  return slot;
}

function isSlotDay(schedule: BackupSchedule, day: Date): boolean {
  return schedule.frequency === 'daily' || schedule.weekdays.includes(day.getDay());
}

/** The latest daily/weekly slot at or before `now`. */
export function previousSlot(schedule: BackupSchedule, now: Date): Date {
  for (let back = 0; back <= 7; back++) {
    const day = new Date(now);
    day.setDate(now.getDate() - back);
    const slot = atTime(day, schedule.time);
    if (slot <= now && isSlotDay(schedule, slot)) return slot;
  }
  // Unreachable with at least one weekday, which the schema requires.
  return atTime(now, schedule.time);
}

/** The first daily/weekly slot after `now`. */
export function followingSlot(schedule: BackupSchedule, now: Date): Date {
  for (let ahead = 0; ahead <= 8; ahead++) {
    const day = new Date(now);
    day.setDate(now.getDate() + ahead);
    const slot = atTime(day, schedule.time);
    if (slot > now && isSlotDay(schedule, slot)) return slot;
  }
  return new Date(now.getTime() + DAY);
}

function latest(...dates: (string | null)[]): Date | null {
  const times = dates.filter((d): d is string => d !== null).map((d) => new Date(d).getTime());
  return times.length === 0 ? null : new Date(Math.max(...times));
}

/**
 * When the next scheduled backup is due. A time in the past means "now". A skipped run counts
 * as done: nothing had changed, so there was nothing to back up.
 */
export function nextDue(schedule: BackupSchedule, state: BackupRunState, now: Date): Date {
  const done = latest(state.lastSuccessAt, state.lastSkippedAt);

  let due: Date;
  if (schedule.frequency === 'hourly') {
    due = done ? new Date(done.getTime() + schedule.everyHours * HOUR) : now;
  } else {
    const previous = previousSlot(schedule, now);
    due = done && done >= previous ? followingSlot(schedule, now) : previous;
  }

  // The last attempt failed after the last success: back off before trying again.
  if (state.lastError && state.lastRunAt) {
    const retry = new Date(new Date(state.lastRunAt).getTime() + RETRY_AFTER_FAILURE_MS);
    if (retry > due) due = retry;
  }
  return due;
}

const NAME_PATTERN = /^jobtrack-(.+)-(\d{8}T\d{6}Z)\.jtbak(\.age)?$/;

/** Target names become part of a filename, so anything unusual is flattened. */
function safeTarget(target: string): string {
  return target.replace(/[^A-Za-z0-9_.]/g, '_') || 'db';
}

/** `jobtrack-<target>-20260925T020000Z.jtbak[.age]`, in UTC so names sort in time order. */
export function backupFileName(target: string, at: Date, encrypted: boolean): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `jobtrack-${safeTarget(target)}-${stamp}.jtbak${encrypted ? '.age' : ''}`;
}

export interface ParsedBackupName {
  target: string;
  at: Date;
  encrypted: boolean;
}

/** Null for anything JobTrack did not write, which is how retention leaves other files alone. */
export function parseBackupFileName(name: string): ParsedBackupName | null {
  const match = NAME_PATTERN.exec(name);
  if (!match) return null;
  const stamp = match[2]!;
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return { target: match[1]!, at, encrypted: match[3] !== undefined };
}

/**
 * Which of this target's backups retention removes. Only files JobTrack named for this same
 * database are considered, and the newest one is always kept, whatever the settings say.
 */
export function expiredBackups(names: string[], target: string, retention: BackupRetention, now: Date): string[] {
  const own = names
    .map((name) => ({ name, parsed: parseBackupFileName(name) }))
    .filter((entry) => entry.parsed?.target === safeTarget(target))
    .sort((a, b) => b.parsed!.at.getTime() - a.parsed!.at.getTime());

  return own
    .filter((entry, index) => {
      if (index === 0) return false;
      if (retention.keepLast !== null && index >= retention.keepLast) return true;
      if (retention.maxAgeDays !== null && now.getTime() - entry.parsed!.at.getTime() > retention.maxAgeDays * DAY) return true;
      return false;
    })
    .map((entry) => entry.name);
}
