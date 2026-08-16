import {
  findGroupIdsForUser,
  findOrganisationMemberByUserId,
  findProcessDefinitionById,
  hasUserHeldTaskOnCase,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import type { Case, CaseTask } from '@orgflow/types';
import type { Transaction } from 'kysely';

import type { RequestSession } from '../middleware/require-session.js';

// PRD.md §12.3 asks two separate questions and insists they are always
// evaluated separately. They are two functions here for exactly that
// reason: seeing a case and being allowed to act on its task are different
// permissions, and collapsing them is how an observer ends up able to
// approve.
//
// Both read membership from the database rather than from the session
// claims. A session is a cookie that lives for twelve hours (ADR-0010), so
// its roles array is a snapshot from sign-in; a revoked role has to take
// effect on the next request, not on the next login.

// Visibility: submitter, current or past assignee, process owner of the
// definition, or admin.
export async function canViewCase(
  trx: Transaction<Database>,
  session: RequestSession,
  found: Case,
): Promise<boolean> {
  if (found.submittedByUserId === session.userId) {
    return true;
  }

  const member = await findOrganisationMemberByUserId(trx, session.userId);
  if (!member) {
    return false;
  }

  if (member.roles.includes('admin') || member.roles.includes('owner')) {
    return true;
  }

  if (member.roles.includes('processOwner')) {
    // "Owned processes" is the definition this user created: nothing else
    // in the schema records ownership, and granting every processOwner
    // sight of every case would make the role equivalent to admin.
    const definition = await findProcessDefinitionById(trx, found.definitionId);
    if (definition?.createdByUserId === session.userId) {
      return true;
    }
  }

  return hasUserHeldTaskOnCase(trx, found.caseId, session.userId);
}

export interface ActionabilityResult {
  allowed: boolean;
  reason?: string;
}

// Actionability: the resolved assignee, or a member of the assigned role or
// group for an unclaimed task. Delegation is the third case PRD.md §12.3
// lists and belongs to Phase 6, so it is absent rather than half-built.
export async function canActOnTask(
  trx: Transaction<Database>,
  session: RequestSession,
  task: CaseTask,
): Promise<ActionabilityResult> {
  if (task.assigneeUserId) {
    return task.assigneeUserId === session.userId
      ? { allowed: true }
      : { allowed: false, reason: 'This task is assigned to somebody else.' };
  }

  const member = await findOrganisationMemberByUserId(trx, session.userId);
  if (!member) {
    return { allowed: false, reason: 'You are not a member of this organisation.' };
  }

  if (
    task.assigneeRole &&
    member.roles.includes(task.assigneeRole as (typeof member.roles)[number])
  ) {
    return { allowed: true };
  }

  if (task.assigneeGroupId) {
    const groupIds = await findGroupIdsForUser(trx, session.userId);
    if (groupIds.includes(task.assigneeGroupId)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: 'This task belongs to a role or group you are not a member of.',
  };
}

// The pools this user can draw claimable work from, which is the same
// membership question GET /tasks/available answers.
export async function resolveClaimablePools(
  trx: Transaction<Database>,
  userId: string,
): Promise<{ roles: string[]; groupIds: string[] }> {
  const [member, groupIds] = await Promise.all([
    findOrganisationMemberByUserId(trx, userId),
    findGroupIdsForUser(trx, userId),
  ]);

  return { roles: member?.roles ?? [], groupIds };
}
