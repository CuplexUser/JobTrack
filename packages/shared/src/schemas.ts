/**
 * Zod schemas shared by the API (request validation) and the web app (form validation), so
 * the two cannot disagree about what a valid application looks like.
 */

import { z } from 'zod';
import {
  APPLICATION_STATUSES,
  CHANNELS,
  CONTACT_LINK_TARGETS,
  CONTACT_ROLES,
  DIRECTIONS,
  WORK_MODES,
  NOTE_TARGETS,
  RELATIONSHIPS,
  TAG_SCOPES,
  LINK_TARGETS,
} from './types.js';
import { STATISTICS_GRANULARITIES } from './statistics.js';

/** A calendar day. Kept as a string end to end; see periods.ts for why. */
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

/** Trimmed free text where an empty box means "not set" rather than an empty string. */
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === '' ? null : v));

export const statusSchema = z.enum(APPLICATION_STATUSES);
export const workModeSchema = z.enum(WORK_MODES);
export const noteTargetSchema = z.enum(NOTE_TARGETS);
export const tagScopeSchema = z.enum(TAG_SCOPES);
export const linkTargetSchema = z.enum(LINK_TARGETS);

const tagList = z.array(z.string().trim().min(1).max(60)).max(30);

/**
 * Creating an application. `companyName` rather than `companyId`: the form lets you type a
 * new employer, and the API resolves-or-creates the company inside one transaction. Tags
 * work the same way, by name.
 */
export const createApplicationSchema = z
  .object({
    companyName: z.string().trim().min(1, 'Company is required').max(200),
    jobTitle: z.string().trim().min(1, 'Job title is required').max(200),
    appliedOn: dateOnly,
    status: statusSchema.default('applied'),
    jobUrl: optionalTrimmed(2000),
    location: optionalTrimmed(200),
    workMode: workModeSchema.default('unspecified'),
    sourceName: optionalTrimmed(120),
    salaryMin: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((v) => v ?? null),
    salaryMax: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((v) => v ?? null),
    salaryCurrency: optionalTrimmed(8),
    followUpOn: dateOnly.nullish().transform((v) => v ?? null),
    tags: tagList.default([]),
    /** Free-text notes typed straight into the form; stored as a linked note. */
    notes: optionalTrimmed(20000),
  })
  .refine((v) => v.salaryMin === null || v.salaryMax === null || v.salaryMin <= v.salaryMax, {
    message: 'Minimum salary cannot exceed the maximum',
    path: ['salaryMin'],
  });

/**
 * Partial update. Declared separately rather than via `.partial()`, because the refine on
 * the create schema wraps the object and makes it unavailable.
 */
export const patchApplicationSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200).optional(),
    jobTitle: z.string().trim().min(1).max(200).optional(),
    appliedOn: dateOnly.optional(),
    status: statusSchema.optional(),
    /** Recorded on the status event when the status is what changed. */
    statusComment: z.string().trim().max(2000).nullish(),
    jobUrl: optionalTrimmed(2000).optional(),
    location: optionalTrimmed(200).optional(),
    workMode: workModeSchema.optional(),
    sourceName: optionalTrimmed(120).optional(),
    salaryMin: z.number().int().nonnegative().nullish(),
    salaryMax: z.number().int().nonnegative().nullish(),
    salaryCurrency: optionalTrimmed(8).optional(),
    followUpOn: dateOnly.nullish(),
    archived: z.boolean().optional(),
    tags: tagList.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const changeStatusSchema = z.object({
  status: statusSchema,
  occurredOn: dateOnly.optional(),
  comment: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v ?? null),
});

/**
 * Repeatable query values arrive either as `?status=a&status=b` or `?status=a,b`.
 * Both are accepted and normalized to an array.
 */
const csvArray = <T extends z.ZodType<string, string>>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const parts = Array.isArray(v) ? v.map(String) : String(v).split(',');
    const cleaned = parts.map((p) => p.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }, z.array(item).optional());

/**
 * Like `csvArray`, but split on `|`. For values that legitimately contain commas — a
 * location is typically written "Stockholm, Sweden", and splitting that on the comma would
 * turn one place into two unrelated search terms.
 */
const pipeArray = <T extends z.ZodType<string, string>>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const parts = Array.isArray(v) ? v.map(String) : String(v).split('|');
    const cleaned = parts.map((p) => p.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }, z.array(item).optional());

/**
 * The list/filter query.
 *
 * The *same* object drives the list view, the search endpoint and both exports — which is
 * what makes "export exactly what I'm looking at" true rather than approximately true.
 * Everything arrives as a string in a URL, so numbers and booleans are coerced here.
 */
export const applicationFilterSchema = z.object({
  q: z.string().trim().max(300).optional(),
  year: z.coerce.number().int().min(1970).max(2200).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  status: csvArray(statusSchema),
  workMode: csvArray(workModeSchema),
  tags: csvArray(z.string()),
  /**
   * Any-of, case- and accent-insensitive *contains* match on the location text, so
   * "Stockholm" also finds "Stockholm, Sweden". `|`-separated in a URL.
   */
  location: pipeArray(z.string().max(200)),
  companyId: z.uuid().optional(),
  source: z.string().trim().max(120).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  archived: z
    .enum(['true', 'false', 'all'])
    .default('false')
    .transform((v) => (v === 'all' ? ('all' as const) : v === 'true')),
  /** Only applications whose follow-up date has arrived and are not yet concluded. */
  followUpDue: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sort: z.enum(['appliedOn', 'company', 'jobTitle', 'status', 'createdAt']).default('appliedOn'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type ApplicationFilter = z.output<typeof applicationFilterSchema>;

/** The duplicates sweep's remove action: the records the user chose not to keep. */
export const bulkDeleteSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
});

/**
 * One status change applied to several applications, such as "mark these ghosted". Each one
 * still gets its own dated status event, exactly as a single change would.
 */
export const bulkStatusChangeSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
  status: statusSchema,
  occurredOn: dateOnly.optional(),
  comment: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v ?? null),
});

/** `true`/`false` from a URL, or a real boolean from JSON (an MCP tool call). */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
  .optional();

/**
 * The openings list filter. Everything here is optional, and an empty filter lists what the
 * page always has: every opening not yet archived.
 */
export const openingFilterSchema = z.object({
  /** Include converted and hand-archived openings alongside the active ones. */
  includeArchived: booleanish,
  /** Words that must all appear in the title, company, location or notes. */
  q: z.string().trim().max(300).optional(),
  /** Same any-of contains match as the applications filter. `|`-separated in a URL. */
  location: pipeArray(z.string().max(200)),
  source: z.string().trim().max(120).optional(),
  /** `fit` ranks by how well each opening matches the profile; newest first otherwise. */
  sort: z.enum(['savedOn', 'fit']).optional(),
  /** Leave out openings scoring below this. Ignored when there is no profile to score against. */
  minFit: z.coerce.number().int().min(0).max(100).optional(),
});

export type OpeningFilter = z.output<typeof openingFilterSchema>;

/**
 * The statistics page's query. No dates means everything on file up to today. Archived
 * applications count by default: statistics measure the effort that went out, and archiving
 * a finished application does not un-send it.
 */
export const statisticsQuerySchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    granularity: z.enum(STATISTICS_GRANULARITIES).optional(),
    archived: z.enum(['all', 'false']).default('all'),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'The start date is after the end date', path: ['from'] });

export type StatisticsQuery = z.output<typeof statisticsQuerySchema>;

export const duplicateCheckSchema = z.object({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).optional().default(''),
  /** Set when editing, so a record does not report itself as its own duplicate. */
  excludeId: z.uuid().optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(300),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  types: csvArray(z.enum(['application', 'company', 'note', 'contact'])),
});

export const exportQuerySchema = applicationFilterSchema.extend({
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

export type ExportQuery = z.output<typeof exportQuerySchema>;

export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  website: optionalTrimmed(2000),
  location: optionalTrimmed(200),
  tags: tagList.default([]),
});

export const patchCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    website: optionalTrimmed(2000).optional(),
    location: optionalTrimmed(200).optional(),
    archived: z.boolean().optional(),
    tags: tagList.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(50000).default(''),
  targetType: noteTargetSchema.default('standalone'),
  targetId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  pinned: z.boolean().default(false),
});

export const patchNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(50000).optional(),
    targetType: noteTargetSchema.optional(),
    targetId: z.uuid().nullish(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: optionalTrimmed(30),
  scope: tagScopeSchema.default('both'),
});

/**
 * A saved opportunity. Deliberately a smaller surface than `createApplicationSchema` — no
 * status, no follow-up, no tags — because an opening is a placeholder, not a tracked process
 * yet.
 */
const jobOpeningFields = z.object({
  companyName: z.string().trim().min(1, 'Company is required').max(200),
  jobTitle: z.string().trim().min(1, 'Job title is required').max(200),
  jobUrl: optionalTrimmed(2000),
  location: optionalTrimmed(200),
  workMode: workModeSchema.default('unspecified'),
  sourceName: optionalTrimmed(120),
  salaryMin: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? null),
  salaryMax: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? null),
  salaryCurrency: optionalTrimmed(8),
  notes: optionalTrimmed(20000),
  savedOn: dateOnly.optional(),
});

const salaryInOrder = (v: { salaryMin: number | null; salaryMax: number | null }) =>
  v.salaryMin === null || v.salaryMax === null || v.salaryMin <= v.salaryMax;
const salaryOrderIssue = { message: 'Minimum salary cannot exceed the maximum', path: ['salaryMin'] };

export const createJobOpeningSchema = jobOpeningFields.refine(salaryInOrder, salaryOrderIssue);

/**
 * `create_opening` over MCP: the same fields, plus the override for its duplicate check.
 * The REST route has no check to override, so the flag lives only here.
 */
export const createOpeningToolSchema = jobOpeningFields
  .extend({
    /** Save even when this posting is already saved or applied to. Only after the user says so. */
    allowDuplicate: z.boolean().default(false),
  })
  .refine(salaryInOrder, salaryOrderIssue);

export const patchJobOpeningSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200).optional(),
    jobTitle: z.string().trim().min(1).max(200).optional(),
    jobUrl: optionalTrimmed(2000).optional(),
    location: optionalTrimmed(200).optional(),
    workMode: workModeSchema.optional(),
    sourceName: optionalTrimmed(120).optional(),
    salaryMin: z.number().int().nonnegative().nullish(),
    salaryMax: z.number().int().nonnegative().nullish(),
    salaryCurrency: optionalTrimmed(8).optional(),
    notes: optionalTrimmed(20000).optional(),
    savedOn: dateOnly.optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

/** Converting a saved opening into a real application — only what a draft cannot supply. */
export const convertJobOpeningSchema = z.object({
  appliedOn: dateOnly.optional(),
  status: statusSchema.optional(),
  tags: tagList.optional(),
});

/**
 * Capturing a posting from the web.
 *
 * `ingestUrlSchema` and `ingestTextSchema` are what the app sends *to* a parser;
 * `postingDraftSchema` is what comes back and what the extension posts to be saved. The
 * draft deliberately mirrors `createJobOpeningSchema` field for field — it is the same
 * record, one step earlier, while the user can still correct it.
 */
export const ingestUrlSchema = z.object({
  url: z.string().trim().min(1).max(2000),
});

export const ingestTextSchema = z.object({
  text: z.string().min(1).max(200000),
  url: optionalTrimmed(2000).optional(),
});

/**
 * Capture from an MCP client: a link to read, or text to parse (with the link it came from,
 * when there is one), optionally saved straight away as an opening.
 */
export const capturePostingSchema = z
  .object({
    url: z.string().trim().min(1).max(2000).optional(),
    text: z.string().min(1).max(200000).optional(),
    save: z.boolean().default(false),
    /** With `save`, save even when this posting is already saved or applied to. */
    allowDuplicate: z.boolean().default(false),
  })
  .refine((v) => v.url !== undefined || v.text !== undefined, {
    message: 'Give a url to read, or the posting text',
  });

/** How many postings one scoring request takes: a page of search results, not a crawl. */
export const MAX_POSTINGS_TO_SCORE = 25;

/**
 * A posting to score against the profile without saving it, such as one an assistant found
 * while searching. Only the title is required; whatever else is known sharpens the score.
 */
export const postingToScoreSchema = z.object({
  companyName: optionalTrimmed(200),
  jobTitle: z.string().trim().min(1, 'Job title is required').max(200),
  location: optionalTrimmed(200),
  workMode: workModeSchema.default('unspecified'),
  salaryMin: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? null),
  salaryMax: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? null),
  salaryCurrency: optionalTrimmed(8),
  /** The posting text, or as much of it as is known. */
  description: optionalTrimmed(20000),
});

export type PostingToScore = z.output<typeof postingToScoreSchema>;

export const scorePostingsSchema = z.object({
  postings: z.array(postingToScoreSchema).min(1).max(MAX_POSTINGS_TO_SCORE),
});

export const postingDraftSchema = z
  .object({
    companyName: z.string().trim().min(1, 'Company is required').max(200),
    jobTitle: z.string().trim().min(1, 'Job title is required').max(200),
    jobUrl: optionalTrimmed(2000),
    location: optionalTrimmed(200),
    workMode: workModeSchema.default('unspecified'),
    sourceName: optionalTrimmed(120),
    salaryMin: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((v) => v ?? null),
    salaryMax: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((v) => v ?? null),
    salaryCurrency: optionalTrimmed(8),
    notes: optionalTrimmed(20000),
  })
  .refine((v) => v.salaryMin === null || v.salaryMax === null || v.salaryMin <= v.salaryMax, {
    message: 'Minimum salary cannot exceed the maximum',
    path: ['salaryMin'],
  });

/** Which configured database target to make active. */
export const switchDbTargetSchema = z.object({
  target: z.string().min(1),
});

// ---------------------------------------------------------------- networking

export const relationshipSchema = z.enum(RELATIONSHIPS);
export const channelSchema = z.enum(CHANNELS);
export const directionSchema = z.enum(DIRECTIONS);
export const contactLinkTargetSchema = z.enum(CONTACT_LINK_TARGETS);
export const contactRoleSchema = z.enum(CONTACT_ROLES);

/**
 * A person in the network. Only the name is required: a contact is often a name and an
 * employer scribbled down after an event, filled in later.
 */
export const createContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  companyName: optionalTrimmed(200),
  headline: optionalTrimmed(300),
  email: optionalTrimmed(320),
  phone: optionalTrimmed(60),
  linkedinUrl: optionalTrimmed(2000),
  relationship: relationshipSchema.default('connection'),
  about: optionalTrimmed(20000),
  reconnectOn: dateOnly.nullish().transform((v) => v ?? null),
});

export const patchContactSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    companyName: optionalTrimmed(200).optional(),
    headline: optionalTrimmed(300).optional(),
    email: optionalTrimmed(320).optional(),
    phone: optionalTrimmed(60).optional(),
    linkedinUrl: optionalTrimmed(2000).optional(),
    relationship: relationshipSchema.optional(),
    about: optionalTrimmed(20000).optional(),
    reconnectOn: dateOnly.nullish(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const contactFilterSchema = z.object({
  /** Words that must all appear in the name, company, headline or notes about them. */
  q: z.string().trim().max(300).optional(),
  /** Everyone at this employer, matched by company key, so "Spotify AB" finds "Spotify". */
  company: z.string().trim().max(200).optional(),
  relationship: csvArray(relationshipSchema),
  /** Only contacts whose reconnect date has arrived. */
  reconnectDue: booleanish,
  includeArchived: booleanish,
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});

export type ContactFilter = z.output<typeof contactFilterSchema>;

/**
 * Logging a conversation. `reconnectOn` is optional and moves the contact's reminder in the
 * same step (null clears it), since "talked to her, check back in a month" is one thought.
 */
export const createInteractionSchema = z.object({
  occurredOn: dateOnly.optional(),
  channel: channelSchema.default('linkedin'),
  direction: directionSchema.default('outbound'),
  summary: z.string().trim().min(1, 'Say what happened').max(5000),
  applicationId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  reconnectOn: dateOnly.nullish(),
});

export const linkContactSchema = z.object({
  targetType: contactLinkTargetSchema,
  targetId: z.uuid(),
  role: contactRoleSchema.default('contact'),
});

// ---------------------------------------------------------------- profile and rules

const shortList = (max: number) => z.array(z.string().trim().min(1).max(200)).max(max);

/**
 * What the user is looking for, used to rank openings by fit. Every part is optional, and a
 * part left empty is simply not scored.
 */
export const profileSchema = z.object({
  /** A CV or a few paragraphs about the user's experience, compared against posting text by meaning. */
  summary: optionalTrimmed(50000),
  targetTitles: shortList(20).default([]),
  locations: shortList(20).default([]),
  workModes: z.array(workModeSchema).max(4).default([]),
  salaryFloor: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? null),
  salaryCurrency: optionalTrimmed(8),
  includeKeywords: shortList(30).default([]),
  excludeKeywords: shortList(30).default([]),
});

export type Profile = z.output<typeof profileSchema>;

/**
 * Changing some of the profile. Fields left out keep their stored value.
 *
 * Spelled out rather than `profileSchema.partial()`: zod still applies a field's `.default()`
 * inside `.partial()`, so a patch naming only `targetTitles` would come back with every list
 * reset to empty and wipe them on save.
 */
export const profilePatchSchema = z.object({
  summary: optionalTrimmed(50000).optional(),
  targetTitles: shortList(20).optional(),
  locations: shortList(20).optional(),
  workModes: z.array(workModeSchema).max(4).optional(),
  salaryFloor: z.number().int().nonnegative().nullish(),
  salaryCurrency: optionalTrimmed(8).optional(),
  includeKeywords: shortList(30).optional(),
  excludeKeywords: shortList(30).optional(),
});

/**
 * Which language the UI shows, shared between the web app and the Windows tray app so a choice
 * made in either one shows up in the other. `code` is a bare string, not an enum of known
 * languages: the set of languages either app actually ships is a UI concern (see `apps/web`'s
 * `SUPPORTED_LANGUAGES` and the Windows app's own list), not something the stored preference
 * should have to be re-validated against here. `null` means "no shared preference has been set
 * yet", which each app is free to resolve its own way (the browser's language, the Windows
 * display language, ...).
 */
export const languageSchema = z.object({
  code: optionalTrimmed(16),
});

export const languagePatchSchema = z.object({
  code: optionalTrimmed(16).optional(),
});

export type Language = z.output<typeof languageSchema>;

/**
 * Automation the user opts into. Both are off (null) until switched on, because each one
 * writes to records the user did not touch.
 */
export const rulesSchema = z.object({
  /** Give a new application a follow-up date this many days after it was applied for. */
  defaultFollowUpDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .nullish()
    .transform((v) => v ?? null),
  /** Mark an application ghosted after this many days with no status change and nothing planned. */
  autoGhostAfterDays: z
    .number()
    .int()
    .min(14)
    .max(365)
    .nullish()
    .transform((v) => v ?? null),
});

export type Rules = z.output<typeof rulesSchema>;

export const rulesPatchSchema = rulesSchema.partial();

/**
 * How fit points are divided among the parts `scoreFit` (in `./fit.ts`) checks, plus the
 * penalty for an excluded keyword and the cosine range the semantic comparison is stretched
 * across. Tunable rather than hardcoded, so a user who finds title matching too dominant, or
 * the semantic floor too strict, can say so without waiting on a release.
 *
 * Bounded generously rather than tightly: the goal is to stop a typo (an extra zero) from
 * producing a nonsensical score, not to second-guess a deliberate choice like "salary does
 * not matter to me" (0) or "only title matters" (everything else 0).
 */
const weight = z.number().int().min(0).max(100);

/**
 * The plain shape, kept separate from the `refine` below so `.partial()` stays available for
 * the patch schema — Zod drops object methods once a schema is wrapped in `ZodEffects`.
 */
const fitWeightsObjectSchema = z.object({
  title: weight.default(30),
  summary: weight.default(25),
  location: weight.default(15),
  workMode: weight.default(10),
  salary: weight.default(10),
  keywords: weight.default(10),
  /** Taken off the earned share for each excluded keyword found. */
  excludedPenalty: weight.default(40),
  /** Cosine similarity at or below this earns nothing from the summary comparison. */
  semanticFloor: z.number().min(0).max(1).default(0.2),
  /** Cosine similarity at or above this earns full marks from the summary comparison. */
  semanticCeiling: z.number().min(0).max(1).default(0.55),
});

export const fitWeightsSchema = fitWeightsObjectSchema.refine((v) => v.semanticCeiling > v.semanticFloor, {
  message: 'semanticCeiling must be greater than semanticFloor',
  path: ['semanticCeiling'],
});

export type FitWeights = z.output<typeof fitWeightsSchema>;

/**
 * Fields left out keep their stored value, same convention as `rulesPatchSchema`. The
 * semantic-range check only applies once both bounds are known, which `updateFitWeights`
 * (settings.service.ts) guarantees by validating the merged, full document rather than the
 * patch alone.
 */
export const fitWeightsPatchSchema = fitWeightsObjectSchema.partial();

/** LinkedIn's `Connections.csv`, sent as text so the browser and the API parse the same bytes. */
export const linkedInImportSchema = z.object({
  csv: z.string().min(1).max(20_000_000),
});

export type CreateApplicationInput = z.input<typeof createApplicationSchema>;
export type PatchApplicationInput = z.input<typeof patchApplicationSchema>;
export type CreateCompanyInput = z.input<typeof createCompanySchema>;
export type CreateNoteInput = z.input<typeof createNoteSchema>;
export type ChangeStatusInput = z.input<typeof changeStatusSchema>;
