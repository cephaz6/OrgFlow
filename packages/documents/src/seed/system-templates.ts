import type { FormSection, TemplateBlueprint, WorkflowStep } from '@orgflow/types';

// PRD.md §9.3's six. "Each demonstrates a different engine capability, so
// the catalogue doubles as engine test coverage", which is why these are
// not six variations on one shape: between them they exercise a conditional
// branch, a group assignment, a chain of thresholds, a sequence of
// automatic-to-action steps, the single-step minimum, and an SLA with an
// escalation chain. system-templates.test.ts runs every one through the
// real engine to a terminal outcome, so a template that could not run
// cannot be seeded.
//
// Keys and group keys are deliberately plain: a clone regenerates the
// definition key if it collides, and resets any group assignment while
// naming what it pointed at (ADR-0043), so these are starting points rather
// than assumptions about the organisation cloning them.

export interface SystemTemplateSeed {
  // Stable across seed runs, so re-seeding updates rather than duplicates.
  key: string;
  name: string;
  description: string;
  category: string;
  icon: string | null;
  blueprint: TemplateBlueprint;
}

function approvalStep(overrides: Partial<WorkflowStep> & Pick<WorkflowStep, 'key' | 'name'>) {
  return {
    type: 'approval',
    assignment: { strategy: 'lineManager' },
    allowedDecisions: ['approve', 'reject'],
    requireCommentOn: ['reject'],
    ...overrides,
  } as WorkflowStep;
}

function actionStep(overrides: Partial<WorkflowStep> & Pick<WorkflowStep, 'key' | 'name'>) {
  return {
    type: 'action',
    assignment: { strategy: 'lineManager' },
    allowedDecisions: ['complete'],
    ...overrides,
  } as WorkflowStep;
}

function section(key: string, title: string, fields: FormSection['fields']): FormSection {
  return { key, title, visibleWhen: null, fields };
}

// 1. Cost-conditional finance approval: one branch, evaluated against a
//    currency field, which is the capability the condition language exists
//    for.
const EQUIPMENT_REQUEST: SystemTemplateSeed = {
  key: 'equipment-request',
  name: 'Equipment request',
  description: 'Request a laptop or other equipment, with finance approval above a threshold.',
  category: 'IT',
  icon: 'laptop',
  blueprint: {
    key: 'equipment-request',
    name: 'Equipment request',
    description: 'Request a laptop or other equipment',
    category: 'IT',
    icon: 'laptop',
    form: {
      titleFieldKey: 'item',
      sections: [
        section('details', 'What you need', [
          { key: 'item', type: 'text', label: 'Item', required: true },
          {
            key: 'cost',
            type: 'currency',
            label: 'Estimated cost',
            required: true,
            hint: 'Anything above 1,000 also needs finance approval.',
          },
          { key: 'justification', type: 'textarea', label: 'Why you need it', required: true },
        ]),
      ],
    },
    workflow: {
      startStepKey: 'managerApproval',
      steps: [
        approvalStep({
          key: 'managerApproval',
          name: 'Manager approval',
          transitions: {
            approve: [
              { when: { field: 'cost', operator: 'gt', value: 1000 }, to: 'financeApproval' },
              { when: null, to: '$completed' },
            ],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
        approvalStep({
          key: 'financeApproval',
          name: 'Finance approval',
          assignment: { strategy: 'role', role: 'approver' },
          transitions: {
            approve: [{ when: null, to: '$completed' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
      ],
    },
  },
};

// 2. Two approvals in sequence, the second by a named group rather than a
//    person, which is the group-resolution path.
const ACCESS_REQUEST: SystemTemplateSeed = {
  key: 'system-access-request',
  name: 'System access request',
  description: 'Request access to a system, approved by a manager and then by security.',
  category: 'IT',
  icon: 'access',
  blueprint: {
    key: 'system-access-request',
    name: 'System access request',
    description: 'Request access to a system',
    category: 'IT',
    icon: 'access',
    form: {
      titleFieldKey: 'system',
      sections: [
        section('request', 'Access needed', [
          { key: 'system', type: 'text', label: 'System name', required: true },
          {
            key: 'accessLevel',
            type: 'select',
            label: 'Level of access',
            required: true,
            options: [
              { value: 'read', label: 'Read only' },
              { value: 'write', label: 'Read and write' },
              { value: 'admin', label: 'Administrator' },
            ],
          },
          { key: 'reason', type: 'textarea', label: 'Why you need it', required: true },
        ]),
      ],
    },
    workflow: {
      startStepKey: 'managerApproval',
      steps: [
        approvalStep({
          key: 'managerApproval',
          name: 'Manager approval',
          transitions: {
            approve: [{ when: null, to: 'securityApproval' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
        approvalStep({
          key: 'securityApproval',
          name: 'Security approval',
          assignment: { strategy: 'group', groupKey: 'security' },
          transitions: {
            approve: [{ when: null, to: '$completed' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
      ],
    },
  },
};

// 3. A chain of thresholds: first-match-wins ordering across three rules,
//    where getting the order wrong changes the outcome. PRD.md §5.4's
//    evaluation order is the thing this one demonstrates.
const EXPENSE_CLAIM: SystemTemplateSeed = {
  key: 'expense-claim',
  name: 'Expense claim',
  description: 'Claim expenses, with the approval chain growing as the amount does.',
  category: 'Finance',
  icon: 'expense',
  blueprint: {
    key: 'expense-claim',
    name: 'Expense claim',
    description: 'Claim back money you have spent',
    category: 'Finance',
    icon: 'expense',
    form: {
      titleFieldKey: 'purpose',
      sections: [
        section('claim', 'Your claim', [
          { key: 'purpose', type: 'text', label: 'What it was for', required: true },
          { key: 'amount', type: 'currency', label: 'Amount', required: true },
          { key: 'incurredOn', type: 'date', label: 'Date incurred', required: true },
          { key: 'receipt', type: 'file', label: 'Receipt', required: true },
        ]),
      ],
    },
    workflow: {
      startStepKey: 'managerApproval',
      steps: [
        approvalStep({
          key: 'managerApproval',
          name: 'Manager approval',
          transitions: {
            // Ordered largest first: a 6,000 claim matches the first rule
            // and stops there. Reversed, everything above 500 would go to
            // finance and the director would never see anything.
            approve: [
              { when: { field: 'amount', operator: 'gt', value: 5000 }, to: 'directorApproval' },
              { when: { field: 'amount', operator: 'gt', value: 500 }, to: 'financeApproval' },
              { when: null, to: '$completed' },
            ],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
        approvalStep({
          key: 'financeApproval',
          name: 'Finance approval',
          assignment: { strategy: 'role', role: 'approver' },
          transitions: {
            approve: [{ when: null, to: '$completed' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
        approvalStep({
          key: 'directorApproval',
          name: 'Director approval',
          assignment: { strategy: 'role', role: 'admin' },
          transitions: {
            approve: [{ when: null, to: 'financeApproval' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
      ],
    },
  },
};

// 4. Four steps in sequence with no branching at all, which is the long
//    linear path: each team completes its part before the next begins.
const ONBOARDING: SystemTemplateSeed = {
  key: 'new-starter-onboarding',
  name: 'New starter onboarding',
  description: 'Take a new starter through HR, IT, facilities and payroll in order.',
  category: 'People',
  icon: 'onboarding',
  blueprint: {
    key: 'new-starter-onboarding',
    name: 'New starter onboarding',
    description: 'Everything a new starter needs, in order',
    category: 'People',
    icon: 'onboarding',
    form: {
      titleFieldKey: 'starterName',
      sections: [
        section('starter', 'The new starter', [
          { key: 'starterName', type: 'text', label: 'Their name', required: true },
          { key: 'startDate', type: 'date', label: 'Start date', required: true },
          { key: 'jobTitle', type: 'text', label: 'Job title', required: true },
          { key: 'manager', type: 'user', label: 'Their manager', required: true },
        ]),
      ],
    },
    workflow: {
      startStepKey: 'hrSetup',
      steps: [
        actionStep({
          key: 'hrSetup',
          name: 'HR setup',
          assignment: { strategy: 'group', groupKey: 'hr' },
          instructions: 'Contract, right to work, and payroll number.',
          transitions: { complete: [{ when: null, to: 'itSetup' }] },
        }),
        actionStep({
          key: 'itSetup',
          name: 'IT setup',
          assignment: { strategy: 'group', groupKey: 'itSupport' },
          instructions: 'Accounts, equipment and access.',
          transitions: { complete: [{ when: null, to: 'facilitiesSetup' }] },
        }),
        actionStep({
          key: 'facilitiesSetup',
          name: 'Facilities setup',
          assignment: { strategy: 'group', groupKey: 'facilities' },
          instructions: 'Desk, building access and parking.',
          transitions: { complete: [{ when: null, to: 'payrollSetup' }] },
        }),
        actionStep({
          key: 'payrollSetup',
          name: 'Payroll setup',
          assignment: { strategy: 'group', groupKey: 'payroll' },
          instructions: 'Add them to the next payroll run.',
          transitions: { complete: [{ when: null, to: '$completed' }] },
        }),
      ],
    },
  },
};

// 5. The minimum a process can be: one step, one decision, two outcomes.
//    Worth having precisely because it is the shape most organisations
//    actually start from.
const ANNUAL_LEAVE: SystemTemplateSeed = {
  key: 'annual-leave-request',
  name: 'Annual leave request',
  description: 'Book time off, approved by your line manager.',
  category: 'People',
  icon: null,
  blueprint: {
    key: 'annual-leave-request',
    name: 'Annual leave request',
    description: 'Book time off',
    category: 'People',
    form: {
      titleFieldKey: 'reason',
      sections: [
        section('dates', 'When', [
          { key: 'firstDay', type: 'date', label: 'First day off', required: true },
          { key: 'lastDay', type: 'date', label: 'Last day off', required: true },
          { key: 'reason', type: 'text', label: 'Reason (optional)' },
        ]),
      ],
    },
    workflow: {
      startStepKey: 'managerApproval',
      steps: [
        approvalStep({
          key: 'managerApproval',
          name: 'Manager approval',
          sla: { durationHours: 72, reminders: [{ atHoursBefore: 24 }] },
          transitions: {
            approve: [{ when: null, to: '$completed' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
      ],
    },
  },
};

// 6. A long SLA with a two-level escalation chain, which is the timer and
//    escalation path PRD.md §15 describes. Nothing else in this catalogue
//    exercises escalation.
const POLICY_EXCEPTION: SystemTemplateSeed = {
  key: 'policy-exception',
  name: 'Policy exception',
  description: 'Ask to depart from a policy, with a risk owner and security sign-off.',
  category: 'Risk',
  icon: null,
  blueprint: {
    key: 'policy-exception',
    name: 'Policy exception',
    description: 'Request an exception to a policy, and record who accepted the risk',
    category: 'Risk',
    form: {
      titleFieldKey: 'policy',
      sections: [
        section('exception', 'The exception', [
          { key: 'policy', type: 'text', label: 'Which policy', required: true },
          {
            key: 'rationale',
            type: 'textarea',
            label: 'Why an exception is needed',
            required: true,
          },
          {
            key: 'expiresOn',
            type: 'date',
            label: 'Review by',
            required: true,
            hint: 'An exception should not be open ended.',
          },
        ]),
      ],
    },
    workflow: {
      startStepKey: 'riskOwnerApproval',
      steps: [
        approvalStep({
          key: 'riskOwnerApproval',
          name: 'Risk owner approval',
          // Two weeks, because a risk decision is not a same-day question,
          // with the chain picking it up if it goes quiet.
          sla: {
            durationHours: 336,
            reminders: [{ atHoursBefore: 48 }],
            escalation: [
              { strategy: 'lineManagerOfAssignee', atHoursAfter: 48 },
              { strategy: 'role', role: 'admin', atHoursAfter: 168 },
            ],
          },
          transitions: {
            approve: [{ when: null, to: 'securityAcceptance' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
        approvalStep({
          key: 'securityAcceptance',
          name: 'Security acceptance',
          assignment: { strategy: 'group', groupKey: 'security' },
          sla: { durationHours: 168 },
          transitions: {
            approve: [{ when: null, to: '$completed' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        }),
      ],
    },
  },
};

export const SYSTEM_TEMPLATES: readonly SystemTemplateSeed[] = [
  EQUIPMENT_REQUEST,
  ACCESS_REQUEST,
  EXPENSE_CLAIM,
  ONBOARDING,
  ANNUAL_LEAVE,
  POLICY_EXCEPTION,
];
