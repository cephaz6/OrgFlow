import type {
  AssignmentStrategy,
  ProcessDefinitionDocument,
  TemplateBlueprint,
  WorkflowStep,
} from '@orgflow/types';

// PRD.md §9.2. Turning a blueprint into a definition somebody can edit.
//
// Pure, like everything in this package: it is handed the facts it needs
// (which keys the target organisation already uses, who is cloning, what
// time it is) and returns a document plus a list of what a human still has
// to decide. The caller persists both.

// PRD.md §9.2: "assignment strategies referencing specific users or groups
// are reset to unresolved and flagged for configuration". There is no
// `unresolved` strategy in the type, and inventing one would ripple through
// the engine, the builder and every exhaustive switch over
// AssignmentStrategy. So the reset target is `lineManager`, which is what
// step-defaults.ts already gives a brand new step, and the "flagged" half
// is carried out of band in CloneWarning rather than encoded in the
// document. The document therefore lands in a state the builder already
// considers ordinary, and the warnings say what to look at.
const RESET_STRATEGY: AssignmentStrategy = { strategy: 'lineManager' };

export interface CloneWarning {
  stepKey: string;
  stepName: string;
  // What the blueprint asked for, so the message can say "this pointed at a
  // group called itSupport" rather than merely "this needs attention".
  original: string;
  reason: 'specificUser' | 'group';
}

export interface CloneTemplateInput {
  blueprint: TemplateBlueprint;
  organisationId: string;
  definitionId: string;
  // Definition keys already in use in the target organisation. The clone
  // regenerates its own key rather than colliding, since
  // process_definitions is unique on (organisation_id, key).
  existingKeys: readonly string[];
  createdByUserId: string;
  now: string;
}

export interface CloneTemplateResult {
  document: ProcessDefinitionDocument;
  warnings: CloneWarning[];
}

// Mirrors the suffixing in apps/web's document-ops, deliberately: a key a
// process owner sees should look the same whether the builder generated it
// or a clone did.
export function uniqueKey(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!existing.includes(candidate)) {
      return candidate;
    }
  }
  return `${base}_${Date.now()}`;
}

function describeAssignment(assignment: AssignmentStrategy): string | null {
  if (assignment.strategy === 'specificUser') {
    return assignment.userId;
  }
  if (assignment.strategy === 'group') {
    return assignment.groupKey;
  }
  return null;
}

// A step's own assignment and every escalation level it configures are both
// AssignmentStrategy, and both can name a user or a group that means
// nothing in the organisation cloning it, so both are reset.
function resetStep(step: WorkflowStep): { step: WorkflowStep; warnings: CloneWarning[] } {
  const warnings: CloneWarning[] = [];

  let assignment = step.assignment;
  const original = describeAssignment(step.assignment);
  if (original !== null) {
    warnings.push({
      stepKey: step.key,
      stepName: step.name,
      original,
      reason: step.assignment.strategy as 'specificUser' | 'group',
    });
    assignment = RESET_STRATEGY;
  }

  const escalation = step.sla?.escalation?.map((rule) => {
    const describedRule = describeAssignment(rule);
    if (describedRule === null) {
      return rule;
    }
    warnings.push({
      stepKey: step.key,
      stepName: step.name,
      original: describedRule,
      reason: rule.strategy as 'specificUser' | 'group',
    });
    return { ...RESET_STRATEGY, atHoursAfter: rule.atHoursAfter };
  });

  const sla =
    step.sla && escalation ? { ...step.sla, escalation } : step.sla ? { ...step.sla } : undefined;

  return {
    step: { ...step, assignment, ...(sla ? { sla } : {}) },
    warnings,
  };
}

export function cloneTemplate(input: CloneTemplateInput): CloneTemplateResult {
  const { blueprint } = input;

  const steps: WorkflowStep[] = [];
  const warnings: CloneWarning[] = [];
  for (const step of blueprint.workflow.steps) {
    const reset = resetStep(step);
    steps.push(reset.step);
    warnings.push(...reset.warnings);
  }

  // A hard copy, per PRD.md §9.2: no templateId is carried into the
  // document, so no later edit of the template can reach this definition,
  // and there is nothing here to trace back to it.
  const document: ProcessDefinitionDocument = {
    ...blueprint,
    key: uniqueKey(blueprint.key, input.existingKeys),
    organisationId: input.organisationId,
    definitionId: input.definitionId,
    versionNumber: 1,
    workflow: { ...blueprint.workflow, steps },
    createdByUserId: input.createdByUserId,
    createdAt: input.now,
  };

  return { document, warnings };
}
