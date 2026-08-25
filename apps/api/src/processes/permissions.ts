import { findGroupIdsForUser, findOrganisationMemberByUserId } from '@orgflow/db';
import type { Database } from '@orgflow/db';
import type { ProcessDefinition } from '@orgflow/types';
import type { Transaction } from 'kysely';

import type { RequestSession } from '../middleware/require-session.js';

// Mirrors apps/api/src/cases/permissions.ts: membership is read from the
// database rather than the session's roles claim, since that claim is a
// snapshot taken at sign-in and can be up to twelve hours stale (ADR-0010).

// Who may create a process definition at all: any processOwner, plus
// admin/owner as a blanket override, matching PRD.md §6.2's role table.
export async function canCreateProcessDefinitions(
  trx: Transaction<Database>,
  session: RequestSession,
): Promise<boolean> {
  const member = await findOrganisationMemberByUserId(trx, session.userId);
  if (!member) {
    return false;
  }
  return (
    member.roles.includes('processOwner') ||
    member.roles.includes('admin') ||
    member.roles.includes('owner')
  );
}

// Who may edit or publish a specific definition's draft: the processOwner
// who created it, a processOwner who belongs to its owning group
// (ADR-0027), or admin/owner. Not every processOwner in the organisation,
// the same narrowing canViewCase applies to "owned processes" for case
// visibility, so that one processOwner cannot rewrite another's process
// unless a group deliberately puts them both in charge of it.
export async function canManageProcessDefinition(
  trx: Transaction<Database>,
  session: RequestSession,
  definition: ProcessDefinition,
): Promise<boolean> {
  const member = await findOrganisationMemberByUserId(trx, session.userId);
  if (!member) {
    return false;
  }
  if (member.roles.includes('admin') || member.roles.includes('owner')) {
    return true;
  }
  if (!member.roles.includes('processOwner')) {
    return false;
  }
  if (definition.createdByUserId === session.userId) {
    return true;
  }
  if (!definition.owningGroupId) {
    return false;
  }
  const groupIds = await findGroupIdsForUser(trx, session.userId);
  return groupIds.includes(definition.owningGroupId);
}
