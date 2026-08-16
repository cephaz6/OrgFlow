import type { ProcessDefinitionDocument, Uuid } from '@orgflow/types';

export const LAPTOP_REQUEST_KEY = 'laptop-request';
export const LAPTOP_REQUEST_REFERENCE_PREFIX = 'LAP';
export const IT_SUPPORT_GROUP_KEY = 'itSupport';

export interface BuildLaptopRequestInput {
  organisationId: Uuid;
  definitionId: Uuid;
  createdByUserId: Uuid;
  createdAt: string;
}

// The Laptop Request definition from PRD.md §4, transcribed as the seeded
// process Phase 1 runs end to end.
//
// One deliberate deviation, and only one: §4's example assigns the finance
// step to `role: 'financeApprover'`, but §12.2 defines the organisation
// role set as member, approver, processOwner, admin and owner.
// 'financeApprover' is not among them, so no member could ever hold it and
// the step would resolve to nobody every time, sending every case above
// £1000 straight to `unassigned`. Since §4 is an illustration of the
// document format rather than a normative fixture, and §12.2 is the actual
// role model, this uses 'approver'. Widening the role union for one
// example would be the tail wagging the dog.
export function buildLaptopRequestDefinition(
  input: BuildLaptopRequestInput,
): ProcessDefinitionDocument {
  return {
    organisationId: input.organisationId,
    definitionId: input.definitionId,
    versionNumber: 1,
    key: LAPTOP_REQUEST_KEY,
    name: 'Laptop request',
    description: 'Request a new or replacement laptop',
    category: 'IT',
    icon: 'laptop',

    form: {
      titleFieldKey: 'laptopModel',
      sections: [
        {
          key: 'details',
          title: 'Equipment details',
          description: 'Tell us what you need',
          visibleWhen: null,
          fields: [
            {
              key: 'laptopModel',
              type: 'select',
              label: 'Which model do you need?',
              hint: 'Choose the closest match. IT will confirm exact specification.',
              required: true,
              options: [
                { value: 'mbp14', label: 'MacBook Pro 14-inch' },
                { value: 'mbp16', label: 'MacBook Pro 16-inch' },
                { value: 'dellXps', label: 'Dell XPS 15' },
                { value: 'other', label: 'Something else' },
              ],
              visibleWhen: null,
              containsPersonalData: false,
            },
            {
              key: 'otherModelDetail',
              type: 'text',
              label: 'Describe what you need',
              required: true,
              visibleWhen: { field: 'laptopModel', operator: 'eq', value: 'other' },
              validation: { maxLength: 200 },
            },
            {
              key: 'estimatedCost',
              type: 'currency',
              label: 'Estimated cost',
              hint: 'In pounds, excluding VAT',
              required: true,
              validation: { min: 0, max: 10000 },
            },
            {
              key: 'justification',
              type: 'textarea',
              label: 'Why do you need this?',
              required: true,
              validation: { minLength: 20, maxLength: 2000 },
            },
            {
              key: 'requiredBy',
              type: 'date',
              label: 'When do you need it by?',
              required: true,
              validation: { minDate: 'today', maxDate: '+365d' },
            },
            {
              key: 'quote',
              type: 'file',
              label: 'Attach a supplier quote',
              hint: 'Required for anything over £1,000',
              required: false,
              visibleWhen: { field: 'estimatedCost', operator: 'gt', value: 1000 },
              validation: {
                maxSizeBytes: 10485760,
                acceptedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
              },
            },
          ],
        },
      ],
    },

    workflow: {
      startStepKey: 'managerApproval',
      steps: [
        {
          key: 'managerApproval',
          name: 'Line manager approval',
          type: 'approval',
          assignment: { strategy: 'lineManager' },
          instructions: "Confirm this request is justified and within your team's budget.",
          allowedDecisions: ['approve', 'reject', 'return'],
          requireCommentOn: ['reject', 'return'],
          sla: {
            durationHours: 48,
            businessHoursOnly: true,
            reminders: [{ atHoursBefore: 12 }],
            escalation: [
              { strategy: 'lineManagerOfAssignee', atHoursAfter: 24 },
              { strategy: 'role', role: 'processOwner', atHoursAfter: 72 },
            ],
          },
          transitions: {
            // Order matters: PRD.md §5.4 evaluates first-match-wins and
            // requires the `when: null` default to come last.
            approve: [
              {
                when: { field: 'estimatedCost', operator: 'gt', value: 1000 },
                to: 'financeApproval',
              },
              { when: null, to: 'itFulfilment' },
            ],
            reject: [{ when: null, to: '$rejected' }],
            return: [{ when: null, to: '$returnedToRequester' }],
          },
        },
        {
          key: 'financeApproval',
          name: 'Finance approval',
          type: 'approval',
          assignment: { strategy: 'role', role: 'approver' },
          instructions: 'Check the cost code and budget availability.',
          allowedDecisions: ['approve', 'reject'],
          requireCommentOn: ['reject'],
          sla: { durationHours: 72, businessHoursOnly: true },
          transitions: {
            approve: [{ when: null, to: 'itFulfilment' }],
            reject: [{ when: null, to: '$rejected' }],
          },
        },
        {
          key: 'itFulfilment',
          name: 'IT fulfilment',
          type: 'action',
          assignment: { strategy: 'group', groupKey: IT_SUPPORT_GROUP_KEY },
          instructions: 'Order the equipment and record the asset tag.',
          allowedDecisions: ['complete'],
          outputFields: [{ key: 'assetTag', type: 'text', label: 'Asset tag', required: true }],
          sla: { durationHours: 120, businessHoursOnly: true },
          transitions: {
            complete: [{ when: null, to: '$completed' }],
          },
        },
      ],
    },

    notifications: {
      onSubmit: [{ to: 'submitter', template: 'caseSubmitted' }],
      onComplete: [{ to: 'submitter', template: 'caseCompleted' }],
      onReject: [{ to: 'submitter', template: 'caseRejected' }],
    },

    retentionDays: 2555,
    createdByUserId: input.createdByUserId,
    createdAt: input.createdAt,
    publishedAt: input.createdAt,
    publishedByUserId: input.createdByUserId,
  };
}
