import type { IsoDateTimeString, Uuid } from './common.js';

export type DomainEventType =
  | 'organisation.created'
  | 'member.invited'
  | 'member.joined'
  | 'member.removed'
  | 'definition.published'
  | 'definition.archived'
  | 'case.submitted'
  | 'case.stepChanged'
  | 'case.returned'
  | 'case.resubmitted'
  | 'case.completed'
  | 'case.rejected'
  | 'case.cancelled'
  | 'case.unassigned'
  | 'task.created'
  | 'task.claimed'
  | 'task.decided'
  | 'task.reassigned'
  | 'task.delegated'
  | 'task.reminderDue'
  | 'task.escalated'
  | 'task.expired'
  | 'attachment.uploaded'
  | 'attachment.scanned'
  | 'export.requested'
  | 'export.completed';

export type DomainEventActorType = 'user' | 'system' | 'scheduler';

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;
  eventType: DomainEventType;
  organisationId: Uuid;
  occurredAt: IsoDateTimeString;
  actorUserId: Uuid | null;
  actorType: DomainEventActorType;
  correlationId: string;
  payload: TPayload;
  schemaVersion: 1;
}
