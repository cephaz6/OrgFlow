import type { TaskDecisionPreview, TaskStatus } from '@orgflow/types';

import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { TaskDetail, TaskQueuePage } from './types';

export interface FetchQueueParams {
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
  definitionId?: string | undefined;
  overdue?: boolean | undefined;
  // Meaningful only on fetchMyQueue: 'pending' is work assigned directly
  // and not yet claimed, 'claimed' is a pool task this caller personally
  // picked up. The claimable pool itself has no such distinction (every
  // row in it is, by definition, unclaimed), so fetchClaimableQueue's own
  // repository query ignores this filter even if it were passed.
  status?: TaskStatus | undefined;
}

function buildQueuePath(base: string, params?: FetchQueueParams): string {
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
  if (params?.definitionId) {
    search.set('definitionId', params.definitionId);
  }
  if (params?.overdue) {
    search.set('overdue', 'true');
  }
  if (params?.status) {
    search.set('status', params.status);
  }
  const queryString = search.toString();
  return queryString ? `${base}?${queryString}` : base;
}

// Assigned to me, and claimable by me. Two calls because they answer two
// different questions and the API keeps them apart: one is work somebody
// has given you, the other is work nobody has taken yet.
export async function fetchMyQueue(params?: FetchQueueParams): Promise<TaskQueuePage> {
  return apiGet<TaskQueuePage>(buildQueuePath('/tasks', params));
}

export async function fetchClaimableQueue(params?: FetchQueueParams): Promise<TaskQueuePage> {
  return apiGet<TaskQueuePage>(buildQueuePath('/tasks/available', params));
}

export async function fetchTask(taskId: string): Promise<TaskDetail | null> {
  try {
    return await apiGet<TaskDetail>(`/tasks/${encodeURIComponent(taskId)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

// Returns null on 404 (no such token) rather than throwing, so the confirm
// screen can render "this link is not valid" instead of an error page,
// mirroring fetchInvitationPreview exactly. Any other failure still
// propagates.
export async function fetchTaskDecisionPreview(token: string): Promise<TaskDecisionPreview | null> {
  try {
    const result = await apiGet<{ decision: TaskDecisionPreview }>(
      `/task-decision-tokens/${encodeURIComponent(token)}`,
    );
    return result.decision;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}
