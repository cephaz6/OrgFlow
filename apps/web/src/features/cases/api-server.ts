import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { CaseCommentEntry, CaseDetail, CasePage } from './types';

// Server-side reads. Kept apart from the mutations in api-client.ts because
// this module transitively imports next/headers, and anything a client
// component touches must not.

export interface FetchMyCasesParams {
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

// view=mine is what makes this "my requests" rather than "every case I am
// allowed to see". The API resolves the user from the session, so there is
// no user id to pass and none that could be tampered with.
export async function fetchMyCases(params?: FetchMyCasesParams): Promise<CasePage> {
  const search = new URLSearchParams({ view: 'mine' });
  if (params?.query) {
    search.set('query', params.query);
  }
  if (params?.cursor) {
    search.set('cursor', params.cursor);
  }
  search.set('limit', String(params?.limit ?? 10));

  return apiGet<CasePage>(`/cases?${search.toString()}`);
}

// Null on 404, so a page can render notFound() rather than an error
// boundary. A case in another organisation, and one this user may not see,
// both arrive here as 404 by design (ADR-0015), and neither is
// distinguished from a case that does not exist.
export async function fetchCase(caseId: string): Promise<CaseDetail | null> {
  try {
    return await apiGet<CaseDetail>(`/cases/${encodeURIComponent(caseId)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

// A separate call rather than folded into fetchCase's response: the case
// detail page already knows from fetchCase's own 404 whether the case is
// visible at all, so this only ever needs to run once that is settled, and
// keeping it apart means posting a new comment can refresh just this list.
export async function fetchCaseComments(caseId: string): Promise<CaseCommentEntry[]> {
  const { data } = await apiGet<{ data: CaseCommentEntry[] }>(
    `/cases/${encodeURIComponent(caseId)}/comments`,
  );
  return data;
}
