import type { AssignmentStrategy, EvaluationContext } from '@orgflow/types';

export interface ResolvedAssignment {
  assigneeUserId: string | null;
  assigneeGroupId: string | null;
  assigneeRole: string | null;
  // False means resolution produced nobody, which PRD.md §7 says must send
  // the case to the explicit `unassigned` state rather than failing
  // silently.
  resolved: boolean;
  reason?: string;
  // Set when the resolved user has an active delegation and the task is
  // redirected to their delegate instead (PRD.md §7: "delegation is
  // applied at resolution time"). Holds the user delegation redirected
  // *away from*, for case_tasks.delegated_from_user_id.
  delegatedFromUserId?: string;
}

function unresolved(reason: string): ResolvedAssignment {
  return {
    assigneeUserId: null,
    assigneeGroupId: null,
    assigneeRole: null,
    resolved: false,
    reason,
  };
}

// PRD.md §7: delegation only ever redirects a *specific person*, never a
// role or group pool (a pool is claimable by anyone eligible, which already
// covers someone being away), so this only looks at assigneeUserId.
function applyDelegation(
  context: EvaluationContext,
  result: ResolvedAssignment,
): ResolvedAssignment {
  if (!result.resolved || !result.assigneeUserId) {
    return result;
  }

  const delegateUserId = context.directory.activeDelegateByUserId[result.assigneeUserId];
  if (!delegateUserId) {
    return result;
  }

  return {
    ...result,
    assigneeUserId: delegateUserId,
    delegatedFromUserId: result.assigneeUserId,
  };
}

// PRD.md §7. Resolution happens at task creation and the outcome is
// persisted on the task, so later membership changes never retroactively
// reassign existing work.
//
// Pool strategies (`role`, `group`) deliberately resolve to a null
// assigneeUserId with the pool recorded instead: the task is claimable by
// anyone eligible, and the first to claim it owns it. That is exactly how
// case_tasks models them, and it is also why delegation (below) never
// touches these two branches: a pool has no single resolved user to
// redirect.
function resolveAssignmentCore(
  strategy: AssignmentStrategy,
  context: EvaluationContext,
): ResolvedAssignment {
  switch (strategy.strategy) {
    case 'specificUser':
      return {
        assigneeUserId: strategy.userId,
        assigneeGroupId: null,
        assigneeRole: null,
        resolved: true,
      };

    case 'submitter':
      // The one strategy PRD.md §7 marks as unable to fail: a case always
      // has a submitter.
      return {
        assigneeUserId: context.submitter.userId,
        assigneeGroupId: null,
        assigneeRole: null,
        resolved: true,
      };

    case 'lineManager': {
      const lineManagerUserId = context.submitter.lineManagerUserId;
      if (!lineManagerUserId) {
        return unresolved('The submitter has no line manager recorded.');
      }
      return {
        assigneeUserId: lineManagerUserId,
        assigneeGroupId: null,
        assigneeRole: null,
        resolved: true,
      };
    }

    case 'role':
      return {
        assigneeUserId: null,
        assigneeGroupId: null,
        assigneeRole: strategy.role,
        resolved: true,
      };

    case 'group': {
      const groupId = context.directory.groupIdsByKey[strategy.groupKey];
      if (!groupId) {
        return unresolved(`No group exists with key '${strategy.groupKey}'.`);
      }
      return {
        assigneeUserId: null,
        assigneeGroupId: groupId,
        assigneeRole: null,
        resolved: true,
      };
    }

    case 'fieldReference':
      // Reading the referenced value needs the case values, which the
      // caller of this function holds; see resolveAssignmentWithValues.
      return unresolved(
        `Strategy 'fieldReference' requires case values; use resolveAssignmentWithValues.`,
      );

    // Used only for escalation (PRD.md §7): the line manager of whoever is
    // currently assigned, not the submitter's. The caller resolves that
    // manager the same way it resolves the submitter's (a database lookup
    // the engine is not allowed to make) and hands it in as
    // context.currentAssignee, set only while resolving an escalation.
    case 'lineManagerOfAssignee': {
      const lineManagerUserId = context.currentAssignee?.lineManagerUserId;
      if (!lineManagerUserId) {
        return unresolved('The current assignee has no line manager recorded.');
      }
      return {
        assigneeUserId: lineManagerUserId,
        assigneeGroupId: null,
        assigneeRole: null,
        resolved: true,
      };
    }

    default: {
      const exhaustive: never = strategy;
      return unresolved(`Unknown assignment strategy: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function resolveAssignment(
  strategy: AssignmentStrategy,
  context: EvaluationContext,
): ResolvedAssignment {
  return applyDelegation(context, resolveAssignmentCore(strategy, context));
}

// fieldReference is the one strategy that reads submitted values rather
// than context, so it takes them explicitly. Everything else delegates.
export function resolveAssignmentWithValues(
  strategy: AssignmentStrategy,
  context: EvaluationContext,
  values: Record<string, unknown>,
): ResolvedAssignment {
  if (strategy.strategy === 'fieldReference') {
    const selected = values[strategy.fieldKey];
    if (typeof selected !== 'string' || selected.length === 0) {
      return unresolved(`Field '${strategy.fieldKey}' does not name a user.`);
    }
    return applyDelegation(context, {
      assigneeUserId: selected,
      assigneeGroupId: null,
      assigneeRole: null,
      resolved: true,
    });
  }

  return resolveAssignment(strategy, context);
}
