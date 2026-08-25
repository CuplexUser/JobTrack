/**
 * Domain vocabulary shared by the API and the web app.
 *
 * These types describe the *wire* shape. The database row shapes live in
 * `apps/api/src/db/schema.ts` (they are what repolayer's `defineSchema` infers) and a
 * type-level test there asserts the two never drift apart.
 */

/** Where an application currently sits in the pipeline. */
export const APPLICATION_STATUSES = [
  'applied',
  'screening',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statuses that still represent a live conversation. */
export const ACTIVE_STATUSES = ['applied', 'screening', 'interview'] as const;

/** Statuses that mean the process is over, whatever the outcome. */
export const CONCLUDED_STATUSES = ['offer', 'rejected', 'withdrawn', 'ghosted'] as const;

/**
 * The happy-path order. Used to offer a one-click "advance" button and to decide whether a
 * status change is a step forward or a correction.
 */
export const STATUS_PROGRESSION = ['applied', 'screening', 'interview', 'offer'] as const;

export function isActiveStatus(status: ApplicationStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isConcludedStatus(status: ApplicationStatus): boolean {
  return (CONCLUDED_STATUSES as readonly string[]).includes(status);
}

/**
 * The next status on the happy path, or null when there is nowhere forward to go.
 * `offer` is the end of the progression; concluded statuses have no successor.
 */
export function nextStatus(status: ApplicationStatus): ApplicationStatus | null {
  const i = (STATUS_PROGRESSION as readonly string[]).indexOf(status);
  if (i === -1 || i === STATUS_PROGRESSION.length - 1) return null;
  return STATUS_PROGRESSION[i + 1] ?? null;
}

/** Presentation colors, kept next to the vocabulary so the UI never invents its own. */
export const STATUS_COLORS: Record<ApplicationStatus, string> = {
  applied: 'blue',
  screening: 'cyan',
  interview: 'gold',
  offer: 'green',
  rejected: 'red',
  withdrawn: 'default',
  ghosted: 'purple',
};

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
};

export const WORK_MODES = ['remote', 'hybrid', 'onsite', 'unspecified'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unspecified: 'Unspecified',
};

/** What a tag or a note can be attached to. */
export const LINK_TARGETS = ['company', 'application'] as const;
export type LinkTarget = (typeof LINK_TARGETS)[number];

/** A note may also float free, attached to nothing. */
export const NOTE_TARGETS = ['company', 'application', 'standalone'] as const;
export type NoteTarget = (typeof NOTE_TARGETS)[number];

export const TAG_SCOPES = ['company', 'application', 'both'] as const;
export type TagScope = (typeof TAG_SCOPES)[number];

export interface Tag {
  id: string;
  name: string;
  nameKey: string;
  color: string | null;
  scope: TagScope;
}

export interface Company {
  id: string;
  name: string;
  nameKey: string;
  website: string | null;
  location: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A company with the counts the list view needs, assembled by the hydrate layer. */
export interface CompanyWithStats extends Company {
  tags: Tag[];
  applicationCount: number;
  activeCount: number;
  lastAppliedOn: string | null;
}

export interface StatusEvent {
  id: string;
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  occurredOn: string;
  comment: string | null;
  createdAt: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  targetType: NoteTarget;
  targetId: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A note plus a human-readable label for whatever it is attached to. */
export interface NoteWithTarget extends Note {
  targetLabel: string | null;
}

export interface JobApplication {
  id: string;
  companyId: string;
  jobTitle: string;
  titleKey: string;
  appliedOn: string;
  periodYear: number;
  periodMonth: number;
  status: ApplicationStatus;
  jobUrl: string | null;
  location: string | null;
  workMode: WorkMode;
  sourceName: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  followUpOn: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What list and detail endpoints actually return: the row with its relations stitched in. */
export interface JobApplicationView extends JobApplication {
  company: Company;
  tags: Tag[];
  noteCount: number;
}

export interface JobApplicationDetail extends JobApplicationView {
  statusEvents: StatusEvent[];
  notes: Note[];
}

/**
 * A saved opportunity, kept for later: "found this, don't have time to apply right now, or
 * don't have everything I need yet." Converting one creates a real `JobApplication` and
 * marks the opening `archived`, with `convertedApplicationId` pointing at what it became.
 */
export interface JobOpening {
  id: string;
  companyId: string;
  jobTitle: string;
  jobUrl: string | null;
  location: string | null;
  workMode: WorkMode;
  sourceName: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  notes: string | null;
  savedOn: string;
  archived: boolean;
  convertedApplicationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobOpeningView extends JobOpening {
  company: Company;
}
