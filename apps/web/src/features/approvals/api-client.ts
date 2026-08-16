import type { WorkflowDecisionAction } from '@orgflow/types';

import { apiPost } from '../../lib/api-client';

export async function claimTask(taskId: string): Promise<void> {
  await apiPost(`/tasks/${taskId}/claim`);
}

export async function decideTask(
  taskId: string,
  decision: WorkflowDecisionAction,
  comment?: string,
): Promise<void> {
  await apiPost(`/tasks/${taskId}/decide`, comment ? { decision, comment } : { decision });
}
