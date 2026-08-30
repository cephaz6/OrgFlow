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

// The explicit click a one-click "Approve" email link leads to: the token
// alone is the authorization, so no taskId or session is passed here.
export async function confirmTaskDecisionToken(token: string): Promise<void> {
  await apiPost(`/task-decision-tokens/${token}/confirm`);
}
