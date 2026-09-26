/**
 * Typed fetch wrapper.
 *
 * Small on purpose. The one thing it must get right is turning the API's structured error
 * body into a thrown `ApiError` carrying the validation details, so a form can show which
 * field the server objected to instead of a generic failure toast.
 */

import type {
  ApplicationStatus,
  Company,
  CompanyWithStats,
  ContactDetail,
  ContactLink,
  ContactView,
  DuplicateCheck,
  FitWeights,
  JobSources,
  KnownLocationChange,
  KnownLocations,
  Interaction,
  JobApplicationDetail,
  JobApplicationView,
  JobOpeningView,
  Language,
  LinkedContact,
  Note,
  Profile,
  RankedOpening,
  Rules,
  BackupConfigPatch,
  BackupEncryption,
  BackupDestination,
  BackupFile,
  BackupRunResult,
  BackupStatus,
  BackupTestResult,
  GeneratedBackupKey,
  NoteWithTarget,
  PostingDraft,
  StatisticsSummary,
  StatusEvent,
  Tag,
  WorkMode,
} from '@jobtrack/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level messages, when the failure was a validation error. */
  get fieldErrors(): { path: string; message: string }[] {
    return Array.isArray(this.details)
      ? (this.details as { path: string; message: string }[])
      : [];
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error ?? 'unknown',
      body?.message ?? response.statusText,
      body?.details,
    );
  }

  return body as T;
}

/** Drop empty values so the URL carries only the filters that are actually set. */
export function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else if (typeof value === 'boolean') {
      search.set(key, String(value));
    } else {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export interface ApplicationListResponse {
  items: JobApplicationView[];
  cursor: string | null;
  hasMore: boolean;
  total: number;
  searched: boolean;
  semanticReady: boolean;
}

export interface LocationOption {
  label: string;
  count: number;
}

export interface PeriodNode {
  year: number;
  month: number;
  count: number;
  months?: PeriodNode[];
}

export interface DuplicateCheckResponse extends DuplicateCheck {
  company: Company | null;
  semanticUsed: boolean;
  /** People the user knows at this employer, closest first. */
  contacts: ContactView[];
}

/** One cluster from the duplicates sweep: the record to keep first, then the repeats. */
export interface DuplicateGroupResponse {
  companyId: string;
  companyName: string;
  kind: 'exact' | 'similar';
  keepId: string;
  members: JobApplicationView[];
}

export interface DuplicateScanResponse {
  groups: DuplicateGroupResponse[];
  scanned: number;
}

/**
 * What a capture returns before anything is saved: the fields we could read, plus the same
 * duplicate verdict the New Application form shows while you type.
 */
export interface IngestResponse {
  draft: PostingDraft;
  duplicate: DuplicateCheckResponse;
}

export interface ClipResponse extends IngestResponse {
  opening: JobOpeningView;
}

/** The statistics page: counts for a range, and every application sent inside it. */
export interface StatisticsResponse extends StatisticsSummary {
  applications: {
    id: string;
    appliedOn: string;
    jobTitle: string;
    company: { id: string; name: string };
    location: string | null;
    workMode: WorkMode;
    sourceName: string | null;
    status: ApplicationStatus;
    jobUrl: string | null;
    archived: boolean;
  }[];
}

export interface DashboardResponse {
  stats: {
    total: number;
    active: number;
    thisMonth: number;
    offers: number;
    rejected: number;
    responseRate: number;
    byStatus: Record<string, number>;
  };
  followUps: JobApplicationView[];
  recentActivity: (StatusEvent & { jobTitle: string; companyName: string })[];
  /** applied → screening → interview → offer, counted from the status history. */
  funnel: {
    status: ApplicationStatus;
    count: number;
    conversion: number | null;
  }[];
  /** The last 24 months, oldest first, empty months included. */
  volume: { year: number; month: number; count: number }[];
  /** Live applications nothing has happened to in a while, longest silence first. */
  stale: (JobApplicationView & { silentSince: string; silentDays: number })[];
  /** People whose reconnect date has arrived, soonest first. */
  reconnect: ContactView[];
}

export interface AutoGhostResponse {
  afterDays: number | null;
  candidates: (JobApplicationView & { silentSince: string; silentDays: number })[];
  changed: number;
}

export interface LinkedInPreviewRow {
  rowNumber: number;
  name: string;
  companyName: string | null;
  headline: string | null;
  connectedOn: string | null;
  verdict: 'new' | 'duplicate' | 'error';
  reason: string | null;
  knownCompany: boolean;
}

export interface LinkedInPreviewResponse {
  mode: 'preview';
  fileErrors: string[];
  totals: { new: number; duplicate: number; error: number; atKnownCompanies: number };
  rows: LinkedInPreviewRow[];
}

export interface LinkedInCommitResponse {
  mode: 'commit';
  fileErrors: string[];
  created: number;
  skipped: number;
}

export interface ImportPreviewRow {
  rowNumber: number;
  sheet: string | null;
  verdict: 'new' | 'duplicate' | 'error';
  jobTitle: string;
  companyName: string;
  appliedOn: string;
  status: ApplicationStatus | null;
  errors: string[];
}

export interface ImportPreviewResponse {
  mode: 'preview';
  fileErrors: string[];
  totals: { new: number; duplicate: number; error: number };
  rows: ImportPreviewRow[];
}

export interface ImportCommitResponse {
  mode: 'commit';
  fileErrors: string[];
  created: number;
  skipped: number;
  failed: number;
  errors: { rowNumber: number; message: string }[];
}

export interface DbTargetsResponse {
  targets: { name: string; driver: 'sqlite' | 'postgres' | 'mysql' }[];
  active: string;
}

/**
 * `name` matters as much as `version` here: a dev server reports `@jobtrack/api` and its own
 * version, while the tray reports `jobtrack` and the version you installed. The numbers
 * differ legitimately, so the UI never shows one without the other.
 */
export interface MetaResponse {
  name: string;
  version: string;
  driver: string;
  /** Where the browser extension's connect page is served; absent before 1.3.0. */
  connectPage?: string;
}

export interface BackupPreviewResponse {
  mode: 'preview';
  exportedAt: string;
  counts: Record<string, number>;
}

export interface BackupCommitResponse {
  mode: 'commit';
  exportedAt: string;
  counts: Record<string, number>;
}

/** What opens an encrypted backup: its passphrase, or the contents of a secret key file. */
export interface BackupSecrets {
  passphrase?: string;
  identity?: string;
}

export interface DataStatusResponse {
  counts: Record<string, number>;
  empty: boolean;
}

export interface ClearDatabaseResponse {
  counts: Record<string, number>;
}

export interface SeedDatabaseResponse {
  applications: number;
  companies: number;
  tags: number;
  notes: number;
  contacts: number;
}

type SearchResultRecord =
  | { type: 'application'; record: JobApplicationView }
  | { type: 'company'; record: Company }
  | { type: 'note'; record: Note }
  | { type: 'contact'; record: ContactView };

export interface SearchResponse {
  results: ({
    entityId: string;
    score: number;
    matchedBy: ('lexical' | 'semantic')[];
  } & SearchResultRecord)[];
  semanticReady: boolean;
  query: string;
}

const IMPORT_CONTENT_TYPE: Record<'csv' | 'xlsx', string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Import posts the raw file, not JSON, so it cannot go through `request()` above — there is
 * no body to `JSON.stringify`, and the content type has to be the file's own rather than
 * `application/json`.
 */
async function importRequest<T>(
  file: File,
  format: 'csv' | 'xlsx',
  mode: 'preview' | 'commit',
): Promise<T> {
  const response = await fetch(`/api/import${toQuery({ format, mode })}`, {
    method: 'POST',
    headers: { 'Content-Type': IMPORT_CONTENT_TYPE[format] },
    body: file,
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error ?? 'unknown',
      body?.message ?? response.statusText,
      body?.details,
    );
  }
  return body as T;
}

/**
 * Backup upload — same reasoning as `importRequest`: a raw file body, not JSON. The file is
 * already gzip + xor-obfuscated (see `backup/codec.ts`), so it goes over as
 * `application/octet-stream`, never as JSON.
 */
async function backupRequest<T>(file: File, mode: 'preview' | 'commit', secrets: BackupSecrets = {}): Promise<T> {
  // Headers, not the URL, so a secret never lands in a log. URI-encoded because an identity
  // file spans several lines.
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  if (secrets.passphrase) headers['X-Backup-Passphrase'] = encodeURIComponent(secrets.passphrase);
  if (secrets.identity) headers['X-Backup-Identity'] = encodeURIComponent(secrets.identity);
  const response = await fetch(`/api/backup/import${toQuery({ mode })}`, {
    method: 'POST',
    headers,
    body: file,
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error ?? 'unknown',
      body?.message ?? response.statusText,
      body?.details,
    );
  }
  return body as T;
}

/**
 * The real, `fetch`-backed implementation. In demo builds (`VITE_DEMO=true`) `./index.js`
 * swaps this out for `demo-client.js`'s in-browser implementation instead — see that file
 * for why, and `demo-client.ts` for the substitute.
 */
export const httpApi = {
  listApplications: (filter: Record<string, unknown>) =>
    request<ApplicationListResponse>(`/api/applications${toQuery(filter)}`),

  getApplication: (id: string) => request<JobApplicationDetail>(`/api/applications/${id}`),

  periods: (archived = false) =>
    request<{ periods: PeriodNode[] }>(`/api/applications/periods${archived ? '?archived=true' : ''}`),

  applicationLocations: () =>
    request<{ locations: LocationOption[] }>('/api/applications/locations'),

  checkDuplicates: (params: { company: string; title?: string; excludeId?: string }) =>
    request<DuplicateCheckResponse>(`/api/applications/check${toQuery(params)}`),

  duplicateGroups: () => request<DuplicateScanResponse>('/api/applications/duplicates'),

  createApplication: (body: unknown) =>
    request<JobApplicationView>('/api/applications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateApplication: (id: string, body: unknown) =>
    request<JobApplicationView>(`/api/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  changeStatus: (id: string, body: unknown) =>
    request<JobApplicationView>(`/api/applications/${id}/status`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteApplication: (id: string) =>
    request<void>(`/api/applications/${id}`, { method: 'DELETE' }),

  deleteApplications: (ids: string[]) =>
    request<{ deleted: number; missing: number }>('/api/applications/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  listCompanies: (params: Record<string, unknown> = {}) =>
    request<{ companies: CompanyWithStats[] }>(`/api/companies${toQuery(params)}`),

  suggestCompanies: (q: string) =>
    request<{ companies: CompanyWithStats[] }>(`/api/companies/suggest${toQuery({ q })}`),

  getCompany: (id: string) =>
    request<{ company: Company & { tags: Tag[] }; applications: JobApplicationView[] }>(
      `/api/companies/${id}`,
    ),

  updateCompany: (id: string, body: unknown) =>
    request<Company>(`/api/companies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  listTags: () => request<{ tags: Tag[] }>('/api/tags'),

  listNotes: (params: Record<string, unknown> = {}) =>
    request<{ notes: NoteWithTarget[] }>(`/api/notes${toQuery(params)}`),

  createNote: (body: unknown) =>
    request<Note>('/api/notes', { method: 'POST', body: JSON.stringify(body) }),

  updateNote: (id: string, body: unknown) =>
    request<Note>(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteNote: (id: string) => request<void>(`/api/notes/${id}`, { method: 'DELETE' }),

  dashboard: () => request<DashboardResponse>('/api/dashboard'),

  statistics: (params: Record<string, unknown> = {}) =>
    request<StatisticsResponse>(`/api/statistics${toQuery(params)}`),

  listContacts: (params: Record<string, unknown> = {}) =>
    request<{ contacts: ContactView[] }>(`/api/contacts${toQuery(params)}`),

  getContact: (id: string) => request<ContactDetail>(`/api/contacts/${id}`),

  createContact: (body: unknown) =>
    request<ContactView>('/api/contacts', { method: 'POST', body: JSON.stringify(body) }),

  updateContact: (id: string, body: unknown) =>
    request<ContactView>(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteContact: (id: string) => request<void>(`/api/contacts/${id}`, { method: 'DELETE' }),

  logInteraction: (contactId: string, body: unknown) =>
    request<Interaction>(`/api/contacts/${contactId}/interactions`, { method: 'POST', body: JSON.stringify(body) }),

  deleteInteraction: (id: string) => request<void>(`/api/interactions/${id}`, { method: 'DELETE' }),

  linkedContacts: (targetType: 'application' | 'opening', targetId: string) =>
    request<{ contacts: LinkedContact[] }>(`/api/contacts/linked/${targetType}/${targetId}`),

  linkContact: (contactId: string, body: unknown) =>
    request<ContactLink>(`/api/contacts/${contactId}/links`, { method: 'POST', body: JSON.stringify(body) }),

  unlinkContact: (linkId: string) => request<void>(`/api/contact-links/${linkId}`, { method: 'DELETE' }),

  previewLinkedInImport: (csv: string) =>
    request<LinkedInPreviewResponse>('/api/contacts/import/linkedin?mode=preview', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),

  commitLinkedInImport: (csv: string) =>
    request<LinkedInCommitResponse>('/api/contacts/import/linkedin?mode=commit', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),

  search: (q: string, types?: string[]) =>
    request<SearchResponse>(`/api/search${toQuery({ q, types, limit: 25 })}`),

  /** Exports are a plain navigation, so the browser handles the download itself. */
  exportUrl: (filter: Record<string, unknown>, format: 'csv' | 'xlsx') =>
    `/api/export${toQuery({ ...filter, format })}`,

  previewImport: (file: File, format: 'csv' | 'xlsx') =>
    importRequest<ImportPreviewResponse>(file, format, 'preview'),

  commitImport: (file: File, format: 'csv' | 'xlsx') =>
    importRequest<ImportCommitResponse>(file, format, 'commit'),

  listOpenings: (params: Record<string, unknown> = {}) =>
    request<{ openings: RankedOpening[] }>(`/api/openings${toQuery(params)}`),

  getProfile: () => request<Profile>('/api/profile'),

  updateProfile: (body: unknown) =>
    request<Profile>('/api/profile', { method: 'PUT', body: JSON.stringify(body) }),

  getRules: () => request<Rules>('/api/rules'),

  updateRules: (body: unknown) => request<Rules>('/api/rules', { method: 'PUT', body: JSON.stringify(body) }),

  getFitWeights: () => request<FitWeights>('/api/fit-weights'),

  updateFitWeights: (body: unknown) =>
    request<FitWeights>('/api/fit-weights', { method: 'PUT', body: JSON.stringify(body) }),

  getKnownLocations: () => request<KnownLocations>('/api/known-locations'),

  addKnownLocation: (place: string) =>
    request<KnownLocations>('/api/known-locations', { method: 'POST', body: JSON.stringify({ place }) }),

  renameKnownLocation: (from: string, to: string) =>
    request<KnownLocationChange>('/api/known-locations/rename', { method: 'POST', body: JSON.stringify({ from, to }) }),

  removeKnownLocation: (place: string) =>
    request<KnownLocationChange>('/api/known-locations/remove', { method: 'POST', body: JSON.stringify({ place }) }),

  getJobSources: () => request<JobSources>('/api/job-sources'),

  updateJobSources: (body: unknown) =>
    request<JobSources>('/api/job-sources', { method: 'PUT', body: JSON.stringify(body) }),

  /** Shared with the Windows tray app; see `settings.service.ts`'s `getLanguage`. */
  getLanguage: () => request<Language>('/api/settings/language'),

  updateLanguage: (body: unknown) =>
    request<Language>('/api/settings/language', { method: 'PUT', body: JSON.stringify(body) }),

  previewAutoGhost: () => request<AutoGhostResponse>('/api/rules/auto-ghost'),

  runAutoGhost: () => request<AutoGhostResponse>('/api/rules/auto-ghost/run', { method: 'POST' }),

  getOpening: (id: string) => request<JobOpeningView>(`/api/openings/${id}`),

  createOpening: (body: unknown) =>
    request<JobOpeningView>('/api/openings', { method: 'POST', body: JSON.stringify(body) }),

  updateOpening: (id: string, body: unknown) =>
    request<JobOpeningView>(`/api/openings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteOpening: (id: string) => request<void>(`/api/openings/${id}`, { method: 'DELETE' }),

  convertOpening: (id: string, body: unknown) =>
    request<JobApplicationView>(`/api/openings/${id}/convert`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  ingestUrl: (url: string) =>
    request<IngestResponse>('/api/ingest/url', { method: 'POST', body: JSON.stringify({ url }) }),

  ingestText: (text: string, url?: string) =>
    request<IngestResponse>('/api/ingest/text', {
      method: 'POST',
      body: JSON.stringify({ text, url: url ?? null }),
    }),

  clipPosting: (draft: PostingDraft) =>
    request<ClipResponse>('/api/ingest/clip', { method: 'POST', body: JSON.stringify(draft) }),

  getDbTargets: () => request<DbTargetsResponse>('/api/db/targets'),

  switchDb: (target: string) =>
    request<{ ok: true; restarting: boolean }>('/api/db/switch', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),

  /** Same reasoning as `exportUrl` — a plain navigation, so the browser downloads it directly. */
  backupExportUrl: '/api/backup/export',

  previewBackup: (file: File, secrets?: BackupSecrets) => backupRequest<BackupPreviewResponse>(file, 'preview', secrets),

  commitBackup: (file: File, secrets?: BackupSecrets) => backupRequest<BackupCommitResponse>(file, 'commit', secrets),

  getAutoBackup: () => request<BackupStatus>('/api/backup/auto'),

  updateAutoBackup: (patch: BackupConfigPatch) =>
    request<BackupStatus>('/api/backup/auto', { method: 'PUT', body: JSON.stringify(patch) }),

  setBackupPassphrase: (passphrase: string | null) =>
    request<BackupStatus>('/api/backup/auto/passphrase', { method: 'PUT', body: JSON.stringify({ passphrase }) }),

  generateBackupKey: () => request<GeneratedBackupKey>('/api/backup/auto/keypair', { method: 'POST' }),

  testAutoBackup: (override: { destination?: BackupDestination; encryption?: BackupEncryption } = {}) =>
    request<BackupTestResult>('/api/backup/auto/test', { method: 'POST', body: JSON.stringify(override) }),

  runAutoBackup: () => request<BackupRunResult>('/api/backup/auto/run', { method: 'POST' }),

  listAutoBackups: () => request<BackupFile[]>('/api/backup/auto/files'),

  getDataStatus: () => request<DataStatusResponse>('/api/backup/status'),

  clearDatabase: () => request<ClearDatabaseResponse>('/api/backup/clear', { method: 'POST' }),

  seedDatabase: () => request<SeedDatabaseResponse>('/api/backup/seed', { method: 'POST' }),

  getMeta: () => request<MetaResponse>('/api/meta'),
};
