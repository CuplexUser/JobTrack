/**
 * The agenda: everything that is waiting on the user, in one read.
 *
 * The dashboard answers "how is the search going"; this answers "what should I do today":
 * follow-ups, quiet applications, idle openings and people to get back in touch with.
 * It is what an MCP client reads for a weekly review, and what the Windows host will poll
 * for reminders, so it carries only lists that ask for an action, never charts or totals.
 */

import {
  parseDateOnly,
  todayDateOnly,
  type ContactView,
  type JobApplicationView,
  type JobOpeningView,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { needsAttention, type StaleApplication } from './dashboard.service.js';
import { listOpenings } from './openings.service.js';
import { reconnectsDue } from './contacts.service.js';

/**
 * How long a saved opening can sit before it is worth deciding on: apply, or let it go.
 * Two weeks, because postings tend to close within a few weeks of going up.
 */
export const OPENING_IDLE_DAYS = 14;

export interface IdleOpening extends JobOpeningView {
  idleDays: number;
}

export interface AgendaPayload {
  today: string;
  /** Follow-up dates that have arrived on live applications, soonest first. */
  followUps: JobApplicationView[];
  /** Live applications with no follow-up date that nothing has moved in a while. */
  goneQuiet: StaleApplication[];
  /** Openings saved a while ago and still neither converted nor archived, oldest first. */
  idleOpenings: IdleOpening[];
  /** People whose reconnect date has arrived, soonest first. */
  reconnect: ContactView[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getAgenda(repos: Repos): Promise<AgendaPayload> {
  const today = todayDateOnly();
  const todayMs = parseDateOnly(today).getTime();

  const [attention, openings, reconnect] = await Promise.all([
    needsAttention(repos),
    listOpenings(repos),
    reconnectsDue(repos),
  ]);

  const idleOpenings = openings
    .map((opening) => ({
      ...opening,
      idleDays: Math.floor((todayMs - parseDateOnly(opening.savedOn).getTime()) / DAY_MS),
    }))
    .filter((opening) => opening.idleDays >= OPENING_IDLE_DAYS)
    .sort((a, b) => b.idleDays - a.idleDays)
    .slice(0, 20);

  return { today, followUps: attention.followUps, goneQuiet: attention.stale, idleOpenings, reconnect };
}
