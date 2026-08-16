import type { TaskQueueEntry } from './types';

// PRD.md §8.4: returning a case parks it on the requester by creating a task
// on this step. It is genuinely work waiting on them, so it belongs in a
// queue, but it is not an approval and there is nothing to decide.
const RETURNED_STEP_KEY = '$returnedToRequester';

// Where a queue row should actually go. Without this, an amendment task
// links to the decision screen, which loads the pinned document, fails to
// find `$returnedToRequester` among the workflow's steps (it is a terminal
// key, not a real step) and tells the requester there is nothing to decide.
// A dead end reached from a row that is correctly telling them to act.
export function taskDestination(entry: TaskQueueEntry): string {
  return entry.stepKey === RETURNED_STEP_KEY
    ? `/cases/${entry.caseId}/amend`
    : `/approvals/${entry.taskId}`;
}

export function isAmendmentTask(entry: TaskQueueEntry): boolean {
  return entry.stepKey === RETURNED_STEP_KEY;
}
