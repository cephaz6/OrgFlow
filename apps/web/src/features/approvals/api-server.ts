import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { TaskDetail, TaskQueuePage } from './types';

export interface FetchQueueParams {
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
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
  const queryString = search.toString();
  return queryString ? `${base}?${queryString}` : base;
}

// Assigned to me, and claimable by me. Two calls because they answer two
// different questions and the API keeps them apart: one is work somebody
// has given you, the other is work nobody has taken yet.
// No status filter: the repository already defaults to pending and claimed,
// which is what "waiting on me" means. Passing a status here would have to
// name a single one, and there are two.
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
