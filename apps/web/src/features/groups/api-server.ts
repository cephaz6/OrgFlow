import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { Group, GroupDetail } from './types';

interface GroupsResponse {
  data: Group[];
}

// Open to any signed-in member (ADR-0027's owning-group select needs
// this), unlike fetchGroupDetail below: never 403s, so there is nothing
// to narrow here.
export async function fetchGroups(): Promise<Group[]> {
  const response = await apiGet<GroupsResponse>('/groups');
  return response.data;
}

// Admin-gated. Returns null on 403 or 404 alike: the management screen
// treats "no access" and "no such group" the same way, a not-found-shaped
// state, since neither is something the caller can act on from here.
export async function fetchGroupDetail(groupId: string): Promise<GroupDetail | null> {
  try {
    return await apiGet<GroupDetail>(`/groups/${encodeURIComponent(groupId)}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      return null;
    }
    throw err;
  }
}
