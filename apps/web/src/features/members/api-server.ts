import type { MemberStatus } from '@orgflow/types';

import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { MemberEntry } from './types';

export interface FetchMembersParams {
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
  status?: MemberStatus | undefined;
}

export interface MemberDirectoryResult {
  members: MemberEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Returns null when the API refuses with 403, so the page can render the
// "admin access required" state rather than an error screen. Narrowed on
// ApiError.status rather than the message text: the message is prose meant
// for a person and will change, the status is the contract.
//
// Any other failure still propagates. A 500 is a fault, not an answer about
// permissions, and swallowing it here would show an empty directory to an
// administrator whose organisation genuinely has members.
export async function fetchMembers(
  params?: FetchMembersParams,
): Promise<MemberDirectoryResult | null> {
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
  if (params?.status) {
    search.set('status', params.status);
  }
  const queryString = search.toString();
  const path = queryString ? `/members?${queryString}` : '/members';

  try {
    return await apiGet<MemberDirectoryResult>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return null;
    }
    throw err;
  }
}
