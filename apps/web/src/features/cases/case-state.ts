import type { CaseResponse } from './types';

// A returned case is `active` with no current step: the engine parks it on
// the requester rather than on a workflow step. Nothing in the status field
// says so, which is why it is computed (PRD.md §8.4).
//
// In its own pure module rather than beside the table that first needed it:
// several screens ask this question now, and a .ts file can be imported by a
// unit test and by other pure logic without dragging JSX or the API client's
// environment validation along behind it.
export function isReturnedToRequester(entry: CaseResponse): boolean {
  return entry.status === 'active' && entry.currentStepKey === null && entry.submittedAt !== null;
}
