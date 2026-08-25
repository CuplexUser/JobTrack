/**
 * Typed fetch wrapper.
 *
 * Small on purpose. The one thing it must get right is turning the API's structured error
 * body into a thrown `ApiError` carrying the validation details, so a form can show which
 * field the server objected to instead of a generic failure toast.
 */

import type {
  Company,
  CompanyWithStats,
  DuplicateCheck,
  JobApplicationDetail,
  JobApplicationView,
  Note,
  NoteWithTarget,
  StatusEvent,
  Tag,
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

export interface PeriodNode {
  year: number;
  month: number;
  count: number;
  months?: PeriodNode[];
}

export interface DuplicateCheckResponse extends DuplicateCheck {
  company: Company | null;
  semanticUsed: boolean;
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
}

export interface SearchResponse {
  results: {
    type: 'application' | 'company' | 'note';
    entityId: string;
    score: number;
    matchedBy: ('lexical' | 'semantic')[];
    record: JobApplicationView | Company | Note;
  }[];
  semanticReady: boolean;
  query: string;
}

export const api = {
  listApplications: (filter: Record<string, unknown>) =>
    request<ApplicationListResponse>(`/api/applications${toQuery(filter)}`),

  getApplication: (id: string) => request<JobApplicationDetail>(`/api/applications/${id}`),

  periods: () => request<{ periods: PeriodNode[] }>('/api/applications/periods'),

  checkDuplicates: (params: { company: string; title?: string; excludeId?: string }) =>
    request<DuplicateCheckResponse>(`/api/applications/check${toQuery(params)}`),

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

  search: (q: string, types?: string[]) =>
    request<SearchResponse>(`/api/search${toQuery({ q, types, limit: 25 })}`),

  /** Exports are a plain navigation, so the browser handles the download itself. */
  exportUrl: (filter: Record<string, unknown>, format: 'csv' | 'xlsx') =>
    `/api/export${toQuery({ ...filter, format })}`,
};
