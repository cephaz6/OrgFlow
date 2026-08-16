import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { CaseDetail, CasePage, CaseResponse } from './types';

// Server-side reads. Kept apart from the mutations in api-client.ts because
// this module transitively imports next/headers, and anything a client
// component touches must not.

// view=mine is what makes this "my requests" rather than "every case I am
// allowed to see". The API resolves the user from the session, so there is
// no user id to pass and none that could be tampered with.
export async function fetchMyCases(): Promise<CaseResponse[]> {
  const page = await apiGet<CasePage>('/cases?view=mine&limit=50');
  return page.data;
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
