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

// PRD.md §7. Resolution happens at task creation and the outcome is
// persisted on the task, so later membership changes never retroactively
// reassign existing work.
//
// Pool strategies (`role`, `group`) deliberately resolve to a null
// assigneeUserId with the pool recorded instead: the task is claimable by
// anyone eligible, and the first to claim it owns it. That is exactly how
// case_tasks models them.
//
// Two things PRD.md §7 describes are deferred, both belonging to later
// phases and both explicitly reported rather than silently skipped:
// delegation at resolution time (Phase 6) and `lineManagerOfAssignee`,
// which exists only for escalation (Phase 6).
export function resolveAssignment(
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

    case 'lineManagerOfAssignee':
      return unresolved(
        `Strategy 'lineManagerOfAssignee' is only used for escalation, which is not implemented yet.`,
      );

    default: {
      const exhaustive: never = strategy;
      return unresolved(`Unknown assignment strategy: ${JSON.stringify(exhaustive)}`);
    }
  }
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
    return {
      assigneeUserId: selected,
      assigneeGroupId: null,
      assigneeRole: null,
      resolved: true,
    };
  }

  return resolveAssignment(strategy, context);
}
