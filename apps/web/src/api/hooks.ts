/**
 * React Query bindings.
 *
 * The invalidation lists are the interesting part: writing an application changes the
 * period counts, the dashboard and the company stats too, so every mutation names
 * everything it can affect. Getting that wrong shows up as a sidebar count that disagrees
 * with the table — exactly the kind of quiet inconsistency this app is meant to avoid.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export const keys = {
  applications: (filter: unknown) => ['applications', filter] as const,
  application: (id: string) => ['application', id] as const,
  periods: () => ['periods'] as const,
  companies: (params: unknown) => ['companies', params] as const,
  company: (id: string) => ['company', id] as const,
  companySuggest: (q: string) => ['company-suggest', q] as const,
  tags: () => ['tags'] as const,
  notes: (params: unknown) => ['notes', params] as const,
  dashboard: () => ['dashboard'] as const,
  duplicates: (params: unknown) => ['duplicates', params] as const,
  search: (q: string) => ['search', q] as const,
};

/** Everything an application write can invalidate. */
function invalidateApplicationScope(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['applications'] });
  void client.invalidateQueries({ queryKey: ['application'] });
  void client.invalidateQueries({ queryKey: ['periods'] });
  void client.invalidateQueries({ queryKey: ['dashboard'] });
  void client.invalidateQueries({ queryKey: ['companies'] });
  void client.invalidateQueries({ queryKey: ['company'] });
  void client.invalidateQueries({ queryKey: ['tags'] });
  void client.invalidateQueries({ queryKey: ['duplicates'] });
  void client.invalidateQueries({ queryKey: ['search'] });
}

export function useApplications(filter: Record<string, unknown>) {
  return useQuery({
    queryKey: keys.applications(filter),
    queryFn: () => api.listApplications(filter),
    placeholderData: (previous) => previous, // keep the table steady while filters change
  });
}

export function useApplication(id: string | undefined) {
  return useQuery({
    queryKey: keys.application(id ?? ''),
    queryFn: () => api.getApplication(id!),
    enabled: Boolean(id),
  });
}

export function usePeriods() {
  return useQuery({ queryKey: keys.periods(), queryFn: () => api.periods() });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard(), queryFn: () => api.dashboard() });
}

export function useTags() {
  return useQuery({ queryKey: keys.tags(), queryFn: () => api.listTags() });
}

export function useCompanies(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: keys.companies(params),
    queryFn: () => api.listCompanies(params),
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: keys.company(id ?? ''),
    queryFn: () => api.getCompany(id!),
    enabled: Boolean(id),
  });
}

export function useNotes(params: Record<string, unknown> = {}) {
  return useQuery({ queryKey: keys.notes(params), queryFn: () => api.listNotes(params) });
}

/**
 * The live duplicate check.
 *
 * Runs only once there is a company to look up — a title alone cannot be a duplicate of
 * anything, since the check is always scoped to one employer. The debounce lives in the
 * component so the delay is visible where the typing happens.
 */
export function useDuplicateCheck(params: {
  company: string;
  title?: string;
  excludeId?: string;
  enabled?: boolean;
}) {
  const { enabled = true, ...query } = params;
  return useQuery({
    queryKey: keys.duplicates(query),
    queryFn: () => api.checkDuplicates(query),
    enabled: enabled && query.company.trim().length > 1,
    staleTime: 5_000,
  });
}

export function useCompanySuggestions(q: string) {
  return useQuery({
    queryKey: keys.companySuggest(q),
    queryFn: () => api.suggestCompanies(q),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  });
}

export function useCreateApplication() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.createApplication(body),
    onSuccess: () => invalidateApplicationScope(client),
  });
}

export function useUpdateApplication() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.updateApplication(id, body),
    onSuccess: () => invalidateApplicationScope(client),
  });
}

export function useChangeStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.changeStatus(id, body),
    onSuccess: () => invalidateApplicationScope(client),
  });
}

export function useDeleteApplication() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteApplication(id),
    onSuccess: () => invalidateApplicationScope(client),
  });
}

export function useUpdateCompany() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.updateCompany(id, body),
    onSuccess: () => invalidateApplicationScope(client),
  });
}

export function useSaveNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: unknown }) =>
      id ? api.updateNote(id, body) : api.createNote(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notes'] });
      void client.invalidateQueries({ queryKey: ['application'] });
      void client.invalidateQueries({ queryKey: ['search'] });
    },
  });
}

export function useDeleteNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notes'] });
      void client.invalidateQueries({ queryKey: ['application'] });
    },
  });
}
