import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { TaskDetail, TaskQueueEntry, TaskQueuePage } from './types';

// Assigned to me, and claimable by me. Two calls because they answer two
// different questions and the API keeps them apart: one is work somebody
// has given you, the other is work nobody has taken yet.
// No status filter: the repository already defaults to pending and claimed,
// which is what "waiting on me" means. Passing a status here would have to
// name a single one, and there are two.
export async function fetchMyQueue(): Promise<TaskQueueEntry[]> {
  const page = await apiGet<TaskQueuePage>('/tasks');
  return page.data;
}

export async function fetchClaimableQueue(): Promise<TaskQueueEntry[]> {
  const page = await apiGet<TaskQueuePage>('/tasks/available');
  return page.data;
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
