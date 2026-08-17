import {
  findActiveDelegateByUserId,
  findGroupIdsByKeyForCurrentTenant,
  findOrganisationMemberByUserId,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import type { Case, EvaluationContext } from '@orgflow/types';
import type { Transaction } from 'kysely';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface BuildEvaluationContextInput {
  submitterUserId: string;
  correlationId: string;
  now: Date;
  existingCase?: Case;
  // The level already recorded on the task being escalated (0 for one
  // never escalated before). Only meaningful when resolving an
  // escalationTriggered event; every other caller leaves it at the default.
  escalationLevel?: number;
  // Who is currently assigned to the task being escalated, so
  // lineManagerOfAssignee (PRD.md §7) can resolve *their* manager rather
  // than the submitter's. Only set by callers resolving an escalation.
  currentAssigneeUserId?: string;
}

// packages/core performs no I/O, so every directory fact the engine needs
// is resolved here and handed in (CLAUDE.md §3, PRD.md §6.4). All of it
// runs on the caller's tenant-scoped transaction, so the member and the
// groups are necessarily this organisation's.
export async function buildEvaluationContext(
  trx: Transaction<Database>,
  input: BuildEvaluationContextInput,
): Promise<EvaluationContext> {
  const [member, groupIdsByKey, activeDelegateByUserId, currentAssigneeMember] = await Promise.all([
    findOrganisationMemberByUserId(trx, input.submitterUserId),
    findGroupIdsByKeyForCurrentTenant(trx),
    findActiveDelegateByUserId(trx, input.now),
    input.currentAssigneeUserId
      ? findOrganisationMemberByUserId(trx, input.currentAssigneeUserId)
      : Promise.resolve(undefined),
  ]);

  const createdAt = input.existingCase ? new Date(input.existingCase.createdAt) : input.now;
  const daysOpen = Math.max(
    0,
    Math.floor((input.now.getTime() - createdAt.getTime()) / MILLISECONDS_PER_DAY),
  );

  return {
    now: input.now.toISOString(),
    correlationId: input.correlationId,
    submitter: {
      userId: input.submitterUserId,
      department: member?.department ?? null,
      roles: member?.roles ?? [],
      // Null here is not an error: the engine's `lineManager` strategy
      // reports it as an unresolved assignment and sends the case to the
      // explicit `unassigned` state, which PRD.md §7 requires be visible
      // rather than silent.
      lineManagerUserId: member?.lineManagerUserId ?? null,
    },
    case: { daysOpen },
    step: { escalationLevel: input.escalationLevel ?? 0 },
    ...(input.currentAssigneeUserId
      ? { currentAssignee: { lineManagerUserId: currentAssigneeMember?.lineManagerUserId ?? null } }
      : {}),
    directory: { groupIdsByKey, activeDelegateByUserId },
  };
}
