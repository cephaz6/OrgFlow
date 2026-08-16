import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { DraftDetail, ManagedDefinition } from './types';

interface ManagementPage {
  data: ManagedDefinition[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchManagedDefinitions(): Promise<ManagedDefinition[]> {
  const page = await apiGet<ManagementPage>('/process-definitions/manage');
  return page.data;
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
