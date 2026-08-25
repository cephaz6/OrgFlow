import { z } from 'zod';

// PRD.md §5: the condition language is a declarative AST, never eval'd.
// Recursive because Condition is recursive (all/any/not nest other
// Conditions); z.lazy is what makes that legal in zod. Shared by the form
// builder (visibleWhen) and the workflow builder (branch conditions), so
// both validate a tenant-authored expression the same way.
const fieldConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'notIn',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'isEmpty',
    'isNotEmpty',
    'isTrue',
    'isFalse',
  ]),
  value: z.unknown().optional(),
});

export const conditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .union([
      fieldConditionSchema,
      z.object({ all: z.array(conditionSchema) }),
      z.object({ any: z.array(conditionSchema) }),
      z.object({ not: conditionSchema }),
    ])
    .nullable(),
);

const fieldOptionSchema = z.object({ value: z.string(), label: z.string() });

// The properties every field type shares, per FormFieldBase in
// packages/types/src/definition-document.ts.
const fieldBaseSchema = {
  key: z
    .string()
    .min(1)
    .max(100)
    // A field key is used as a Mongo document key (case values) and as a
    // condition reference target, so it is restricted to what both can
    // hold without escaping: no dots, no leading $.
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]*$/,
      'Use letters, numbers and underscores, starting with a letter.',
    ),
  label: z.string().min(1).max(500),
  hint: z.string().max(1000).optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  visibleWhen: conditionSchema.optional(),
  containsPersonalData: z.boolean().optional(),
  readOnlyAfterSubmit: z.boolean().optional(),
};

// One branch per FieldType, matching packages/types/src/definition-document.ts's
// FormField union exactly, so a document this validates is always a valid
// FormField and never merely "looks like one".
export const formFieldSchema: z.ZodType<unknown> = z.discriminatedUnion('type', [
  z.object({
    ...fieldBaseSchema,
    type: z.literal('text'),
    validation: z
      .object({
        minLength: z.number().int().min(0).optional(),
        maxLength: z.number().int().min(1).optional(),
        pattern: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('textarea'),
    validation: z
      .object({
        minLength: z.number().int().min(0).optional(),
        maxLength: z.number().int().min(1).optional(),
      })
      .optional(),
  }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('number'),
    validation: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().positive().optional(),
      })
      .optional(),
  }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('currency'),
    validation: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('select'),
    options: z.array(fieldOptionSchema).min(1),
  }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('multiSelect'),
    options: z.array(fieldOptionSchema).min(1),
    validation: z
      .object({
        minSelections: z.number().int().min(0).optional(),
        maxSelections: z.number().int().min(1).optional(),
      })
      .optional(),
  }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('radio'),
    options: z.array(fieldOptionSchema).min(1),
  }),
  z.object({ ...fieldBaseSchema, type: z.literal('checkbox') }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('date'),
    validation: z
      .object({ minDate: z.string().optional(), maxDate: z.string().optional() })
      .optional(),
  }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('dateTime'),
    validation: z
      .object({ minDate: z.string().optional(), maxDate: z.string().optional() })
      .optional(),
  }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('file'),
    validation: z
      .object({
        maxSizeBytes: z.number().int().positive().optional(),
        acceptedMimeTypes: z.array(z.string()).optional(),
        maxFiles: z.number().int().positive().optional(),
      })
      .optional(),
  }),
  z.object({
    ...fieldBaseSchema,
    type: z.literal('user'),
    validation: z
      .object({ restrictToRole: z.string().optional(), restrictToGroup: z.string().optional() })
      .optional(),
  }),
  z.object({ ...fieldBaseSchema, type: z.literal('email') }),
  z.object({ ...fieldBaseSchema, type: z.literal('phone') }),
  z.object({ ...fieldBaseSchema, type: z.literal('heading') }),
  z.object({ ...fieldBaseSchema, type: z.literal('paragraph') }),
]);

export const formSectionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]*$/,
      'Use letters, numbers and underscores, starting with a letter.',
    ),
  title: z.string().min(1).max(500),
  description: z.string().max(1000).optional(),
  visibleWhen: conditionSchema.optional(),
  fields: z.array(formFieldSchema),
});

// The workflow builder does not exist yet (this is the form builder's
// branch), so this schema exists only so a saved draft's workflow half
// round-trips validly; nothing here is written by a UI yet. The one
// exception is startStepKey and an empty steps array, which the create
// endpoint bootstraps to a terminal key so a form-only draft is already a
// structurally complete, publishable (if trivial) process.
const transitionRuleSchema = z.object({ when: conditionSchema.optional(), to: z.string() });

const slaRuleSchema = z.object({ atHoursBefore: z.number().nonnegative() });

// Matches AssignmentStrategy in packages/types/src/assignment.ts exactly,
// the same reason formFieldSchema is a discriminated union rather than
// z.record(z.unknown()): resolveAssignment (packages/core/src/engine/assignment.ts)
// switches on `strategy` and would otherwise be handed a shape it cannot
// resolve at case-submission time instead of at draft-save time.
const assignmentStrategySchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('specificUser'), userId: z.string().uuid() }),
  z.object({ strategy: z.literal('role'), role: z.string().min(1) }),
  z.object({ strategy: z.literal('lineManager') }),
  z.object({ strategy: z.literal('lineManagerOfAssignee') }),
  z.object({ strategy: z.literal('submitter') }),
  z.object({ strategy: z.literal('group'), groupKey: z.string().min(1) }),
  z.object({ strategy: z.literal('fieldReference'), fieldKey: z.string().min(1) }),
]);

// EscalationRule is AssignmentStrategy & { atHoursAfter: number }; expressed
// as a union of the same seven branches rather than z.record(...).and(...)
// so an escalation rule is held to the same shape a step's own assignment is.
const escalationRuleSchema = z.union([
  z.object({
    strategy: z.literal('specificUser'),
    userId: z.string().uuid(),
    atHoursAfter: z.number().nonnegative(),
  }),
  z.object({
    strategy: z.literal('role'),
    role: z.string().min(1),
    atHoursAfter: z.number().nonnegative(),
  }),
  z.object({ strategy: z.literal('lineManager'), atHoursAfter: z.number().nonnegative() }),
  z.object({
    strategy: z.literal('lineManagerOfAssignee'),
    atHoursAfter: z.number().nonnegative(),
  }),
  z.object({ strategy: z.literal('submitter'), atHoursAfter: z.number().nonnegative() }),
  z.object({
    strategy: z.literal('group'),
    groupKey: z.string().min(1),
    atHoursAfter: z.number().nonnegative(),
  }),
  z.object({
    strategy: z.literal('fieldReference'),
    fieldKey: z.string().min(1),
    atHoursAfter: z.number().nonnegative(),
  }),
]);

const workflowStepSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1).max(500),
  type: z.enum(['approval', 'action', 'acknowledgement', 'automatic']),
  assignment: assignmentStrategySchema,
  instructions: z.string().max(2000).optional(),
  allowedDecisions: z.array(z.enum(['approve', 'reject', 'return', 'complete'])),
  requireCommentOn: z.array(z.enum(['approve', 'reject', 'return', 'complete'])).optional(),
  outputFields: z.array(formFieldSchema).optional(),
  sla: z
    .object({
      durationHours: z.number().positive(),
      businessHoursOnly: z.boolean().optional(),
      reminders: z.array(slaRuleSchema).optional(),
      escalation: z.array(escalationRuleSchema).optional(),
    })
    .optional(),
  transitions: z.record(z.array(transitionRuleSchema)),
  allowSelfApproval: z.boolean().optional(),
});

const notificationRuleSchema = z.object({ to: z.string(), template: z.string() });

// The full document body PATCH /process-definitions/:id/draft accepts. Not
// every field on ProcessDefinitionDocument is here: organisationId,
// definitionId, versionNumber, createdByUserId, createdAt, publishedAt and
// publishedByUserId are all set by the server, never taken from the
// request body, so a tenant cannot forge which organisation or definition
// a document belongs to.
export const definitionDocumentBodySchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  category: z.string().max(200).optional(),
  icon: z.string().max(100).optional(),
  // ADR-0026: absent or null means no owning group, unchanged from before
  // this existed. Validated only as a UUID here; that it names a real
  // group in this organisation is a database foreign-key concern, not a
  // body-shape one.
  owningGroupId: z.string().uuid().nullable().optional(),
  form: z.object({
    // Empty until the builder designates a title field, matching the
    // bootstrap document a new definition starts from (see
    // bootstrapDocument in routes/process-definitions.ts).
    titleFieldKey: z.string(),
    sections: z.array(formSectionSchema),
  }),
  workflow: z.object({
    startStepKey: z.string().min(1),
    steps: z.array(workflowStepSchema),
  }),
  notifications: z
    .object({
      onSubmit: z.array(notificationRuleSchema).optional(),
      onComplete: z.array(notificationRuleSchema).optional(),
      onReject: z.array(notificationRuleSchema).optional(),
    })
    .optional(),
  retentionDays: z.number().int().positive().optional(),
});

export type DefinitionDocumentBody = z.infer<typeof definitionDocumentBodySchema>;

// POST /process-definitions: only what cannot be inferred later. key is
// derived from name server-side (slugified) rather than taken from the
// body, so two definitions cannot be created with the same slug through a
// client-side race on what "kebab-case the name" means.
export const createProcessDefinitionBodySchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  category: z.string().max(200).optional(),
  icon: z.string().max(100).optional(),
  // e.g. 'LAP' -> LAP-000123. Uppercase only, since it appears verbatim in
  // every case reference this definition ever produces.
  referencePrefix: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z]+$/, 'Use two to ten uppercase letters, e.g. LAP.'),
  retentionDays: z.number().int().positive().optional(),
  // ADR-0026: same optional/nullable UUID as definitionDocumentBodySchema.
  owningGroupId: z.string().uuid().nullable().optional(),
});

export type CreateProcessDefinitionBody = z.infer<typeof createProcessDefinitionBodySchema>;

export const publishDraftBodySchema = z
  .object({
    changeNote: z.string().max(2000).optional(),
  })
  .optional();
