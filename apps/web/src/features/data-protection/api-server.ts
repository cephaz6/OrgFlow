import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { RetentionEntry, SubjectExport } from './types';

export type SubjectExportResult =
  { kind: 'ok'; data: SubjectExport } | { kind: 'forbidden' } | { kind: 'not-found' };

// Three-way, unlike fetchMembers' null-on-403: this screen is reached with
// a specific userId in the URL, so "no such member" and "you may not see
// this" are different things to tell an administrator, not the same empty
// state.
export async function fetchSubjectExport(userId: string): Promise<SubjectExportResult> {
  try {
    const data = await apiGet<SubjectExport>(
      `/data-protection/subject-export?userId=${encodeURIComponent(userId)}`,
    );
    return { kind: 'ok', data };
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return { kind: 'forbidden' };
    }
    if (err instanceof ApiError && err.status === 404) {
      return { kind: 'not-found' };
    }
    throw err;
  }
}

// Null on 403, matching fetchMembers/fetchIdentityProviders: this screen
// has no per-resource id in its URL, so there is nothing to tell apart
// from "no such thing" the way subject-export's three-way result does.
export async function fetchRetentionSettings(): Promise<RetentionEntry[] | null> {
  try {
    const { definitions } = await apiGet<{ definitions: RetentionEntry[] }>(
      '/data-protection/retention',
    );
    return definitions;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return null;
    }
    throw err;
  }
}
