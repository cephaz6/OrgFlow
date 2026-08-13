import type { AssignmentStrategy } from './assignment.js';
import type { IsoDateTimeString, Uuid } from './common.js';
import type { Condition } from './condition.js';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'select'
  | 'multiSelect'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'dateTime'
  | 'file'
  | 'user'
  | 'email'
  | 'phone'
  | 'heading'
  | 'paragraph';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FormFieldBase {
  key: string;
  type: FieldType;
  label: string;
  hint?: string;
  required?: boolean;
  defaultValue?: unknown;
  visibleWhen?: Condition | null;
  containsPersonalData?: boolean;
  readOnlyAfterSubmit?: boolean;
}

export interface TextFieldValidation {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface NumberFieldValidation {
  min?: number;
  max?: number;
  step?: number;
}

export interface CurrencyFieldValidation {
  min?: number;
  max?: number;
}

export interface MultiSelectFieldValidation {
  minSelections?: number;
  maxSelections?: number;
}

export interface DateFieldValidation {
  minDate?: string;
  maxDate?: string;
}

export interface FileFieldValidation {
  maxSizeBytes?: number;
  acceptedMimeTypes?: string[];
  maxFiles?: number;
}

export interface UserFieldValidation {
  restrictToRole?: string;
  restrictToGroup?: string;
}

export type FormField =
  | (FormFieldBase & { type: 'text'; validation?: TextFieldValidation })
  | (FormFieldBase & {
      type: 'textarea';
      validation?: Pick<TextFieldValidation, 'minLength' | 'maxLength'>;
    })
  | (FormFieldBase & { type: 'number'; validation?: NumberFieldValidation })
  | (FormFieldBase & { type: 'currency'; validation?: CurrencyFieldValidation })
  | (FormFieldBase & { type: 'select'; options: FieldOption[] })
  | (FormFieldBase & {
      type: 'multiSelect';
      options: FieldOption[];
      validation?: MultiSelectFieldValidation;
    })
  | (FormFieldBase & { type: 'radio'; options: FieldOption[] })
  | (FormFieldBase & { type: 'checkbox' })
  | (FormFieldBase & { type: 'date'; validation?: DateFieldValidation })
  | (FormFieldBase & { type: 'dateTime'; validation?: DateFieldValidation })
  | (FormFieldBase & { type: 'file'; validation?: FileFieldValidation })
  | (FormFieldBase & { type: 'user'; validation?: UserFieldValidation })
  | (FormFieldBase & { type: 'email' })
  | (FormFieldBase & { type: 'phone' })
  | (FormFieldBase & { type: 'heading' })
  | (FormFieldBase & { type: 'paragraph' });

export interface FormSection {
  key: string;
  title: string;
  description?: string;
  visibleWhen?: Condition | null;
  fields: FormField[];
}

export type StepType = 'approval' | 'action' | 'acknowledgement' | 'automatic';

// Present-tense action a user takes on a task, e.g. what allowedDecisions lists.
// Distinct from TaskDecision, the past-tense outcome recorded once the action is taken.
export type WorkflowDecisionAction = 'approve' | 'reject' | 'return' | 'complete';

export interface TransitionRule {
  when: Condition | null;
  to: string;
}

export interface SlaReminderRule {
  atHoursBefore: number;
}

export type EscalationRule = AssignmentStrategy & { atHoursAfter: number };

export interface SlaConfig {
  durationHours: number;
  businessHoursOnly?: boolean;
  reminders?: SlaReminderRule[];
  escalation?: EscalationRule[];
}

export interface WorkflowStep {
  key: string;
  name: string;
  type: StepType;
  assignment: AssignmentStrategy;
  instructions?: string;
  allowedDecisions: WorkflowDecisionAction[];
  requireCommentOn?: WorkflowDecisionAction[];
  outputFields?: FormField[];
  sla?: SlaConfig;
  transitions: Record<string, TransitionRule[]>;
  allowSelfApproval?: boolean;
}

export interface DefinitionNotificationRule {
  to: string;
  template: string;
}

export interface DefinitionNotifications {
  onSubmit?: DefinitionNotificationRule[];
  onComplete?: DefinitionNotificationRule[];
  onReject?: DefinitionNotificationRule[];
}

export type TerminalStepKey = '$completed' | '$rejected' | '$cancelled' | '$returnedToRequester';

export interface ProcessDefinitionDocument {
  _id?: string;
  organisationId: Uuid;
  definitionId: Uuid;
  versionNumber: number;
  key: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  form: {
    titleFieldKey: string;
    sections: FormSection[];
  };
  workflow: {
    startStepKey: string;
    steps: WorkflowStep[];
  };
  notifications?: DefinitionNotifications;
  retentionDays?: number;
  createdByUserId: Uuid;
  createdAt: IsoDateTimeString;
  publishedAt?: IsoDateTimeString;
  publishedByUserId?: Uuid;
}
