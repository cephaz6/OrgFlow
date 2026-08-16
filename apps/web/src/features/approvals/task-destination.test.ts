import { describe, expect, it } from 'vitest';

import { isAmendmentTask, taskDestination } from './task-destination';
import type { TaskQueueEntry } from './types';

function entryOf(overrides: Partial<TaskQueueEntry>): TaskQueueEntry {
  return {
    taskId: 'task-1',
    organisationId: 'org-1',
    caseId: 'case-1',
    stepKey: 'managerApproval',
    stepName: 'Line manager approval',
    taskType: 'approval',
    assignmentStrategy: 'lineManager',
    assigneeUserId: 'user-1',
    assigneeGroupId: null,
    assigneeRole: null,
    delegatedFromUserId: null,
    status: 'pending',
    decision: null,
    comment: null,
    dueAt: null,
    escalationLevel: 0,
    escalatedAt: null,
    claimedByUserId: null,
    claimedAt: null,
    completedByUserId: null,
    completedAt: null,
    rowVersion: 1,
    createdAt: '2026-08-16T09:00:00.000Z',
    updatedAt: '2026-08-16T09:00:00.000Z',
    caseReference: 'LAP-000001',
    caseTitle: 'mbp14',
    definitionId: 'def-1',
    requesterUserId: 'user-2',
    requesterName: 'Priya Nair',
    ...overrides,
  };
}

describe('taskDestination', () => {
  it('sends an ordinary approval to the decision screen', () => {
    expect(taskDestination(entryOf({ taskId: 'task-9' }))).toBe('/approvals/task-9');
  });

  it('sends an amendment task to the amend form, not the decision screen', () => {
    // The decision screen loads the pinned document and looks the step up in
    // workflow.steps. `$returnedToRequester` is a terminal key rather than a
    // real step, so it is never found there, and the requester would be told
    // there is nothing to decide about work that is genuinely waiting on
    // them. Regression test for exactly that dead end.
    const entry = entryOf({ stepKey: '$returnedToRequester', caseId: 'case-42' });
    expect(taskDestination(entry)).toBe('/cases/case-42/amend');
  });
});

describe('isAmendmentTask', () => {
  it('distinguishes an amendment from an approval', () => {
    expect(isAmendmentTask(entryOf({ stepKey: '$returnedToRequester' }))).toBe(true);
    expect(isAmendmentTask(entryOf({ stepKey: 'managerApproval' }))).toBe(false);
    expect(isAmendmentTask(entryOf({ stepKey: 'itFulfilment' }))).toBe(false);
  });
});
