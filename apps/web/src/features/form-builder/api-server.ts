import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { DraftDetail, ManagedDefinition } from './types';

export interface ManagementPage {
  data: ManagedDefinition[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FetchManagedDefinitionsParams {
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function fetchManagedDefinitions(
  params?: FetchManagedDefinitionsParams,
): Promise<ManagementPage> {
  const search = new URLSearchParams();
  if (params?.query) {
    search.set('query', params.query);
  }
  if (params?.cursor) {
    search.set('cursor', params.cursor);
  }
  if (params?.limit) {
    search.set('limit', String(params.limit));
  }
  const queryString = search.toString();
  const path = queryString
    ? `/process-definitions/manage?${queryString}`
    : '/process-definitions/manage';

  return apiGet<ManagementPage>(path);
}

// A published definition has no open draft until it is next edited (see
// apps/api/src/routes/process-definitions.ts's PATCH .../draft, which opens
// one on demand). GET .../draft is 409 in that gap, so this falls back to
// the published detail: the builder can still open and show it, and its
// first save is what actually opens the new draft.
export async function fetchDraft(definitionId: string): Promise<DraftDetail> {
  try {
    return await apiGet<DraftDetail>(
      `/process-definitions/${encodeURIComponent(definitionId)}/draft`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return apiGet<DraftDetail>(`/process-definitions/${encodeURIComponent(definitionId)}`);
    }
    throw err;
  }
}
