import type { IsoDateTimeString, Uuid } from './common.js';

export type AuditActorType = 'user' | 'system' | 'scheduler';

export interface AuditEvent {
  auditEventId: Uuid;
  organisationId: Uuid;
  actorUserId: Uuid | null;
  actorType: AuditActorType;
  entityType: string;
  entityId: Uuid | null;
  action: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: IsoDateTimeString;
}
