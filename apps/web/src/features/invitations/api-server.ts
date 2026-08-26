import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { InvitationEntry, InvitationPreview } from './types';

export interface FetchInvitationsParams {
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface InvitationsPageResult {
  invitations: InvitationEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Same 403-to-null narrowing as features/members: an administration screen
// asking whether the viewer may manage invitations, not an error.
export async function fetchInvitations(
  params?: FetchInvitationsParams,
): Promise<InvitationsPageResult | null> {
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
  const path = queryString ? `/invitations?${queryString}` : '/invitations';

  try {
    return await apiGet<InvitationsPageResult>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return null;
    }
    throw err;
  }
}

// Returns null on 404 (no such token) rather than throwing, so the accept
// screen can render "this link is not valid" instead of an error page. Any
// other failure still propagates.
export async function fetchInvitationPreview(token: string): Promise<InvitationPreview | null> {
  try {
    const result = await apiGet<{ invitation: InvitationPreview }>(`/invitations/${token}`);
    return result.invitation;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}
