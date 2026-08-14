import type { AuditActorType, AuditEvent } from '@orgflow/types';
import type { Selectable, Transaction } from 'kysely';

import type { AuditEventsTable, Database } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<AuditEventsTable>): AuditEvent {
  return {
    auditEventId: row.audit_event_id,
    organisationId: row.organisation_id,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type as AuditActorType,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    payload: row.payload,
    correlationId: row.correlation_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    occurredAt: row.occurred_at.toISOString(),
  };
}

export interface AppendAuditEventInput {
  organisationId: string;
  actorUserId: string | null;
  actorType?: AuditActorType;
  entityType: string;
  entityId: string | null;
  action: string;
  payload?: Record<string, unknown>;
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Takes a Transaction, never a Kysely, and that is the whole point:
// GOV-STANDARDS.md §6.5 requires the audit row to be written in the same
// transaction as the state change it describes, so an audit gap is
// impossible by construction rather than by remembering. The signature
// makes calling it outside a transaction a type error.
//
// The table is append-only, enforced by grants (see the audit-and-
// idempotency migration): orgflow_app holds INSERT and SELECT, never
// UPDATE or DELETE. There is deliberately no update or delete function
// here to match.
export async function appendAuditEvent(
  trx: Transaction<Database>,
  input: AppendAuditEventInput,
): Promise<AuditEvent> {
  const row = await trx
    .insertInto('audit_events')
    .values({
      audit_event_id: generateId(),
      organisation_id: input.organisationId,
      actor_user_id: input.actorUserId,
      ...(input.actorType ? { actor_type: input.actorType } : {}),
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      ...(input.payload ? { payload: input.payload } : {}),
      correlation_id: input.correlationId ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export async function findAuditEventsForCase(
  trx: Transaction<Database>,
  caseId: string,
): Promise<AuditEvent[]> {
  const rows = await trx
    .selectFrom('audit_events')
    .selectAll()
    .where('entity_type', '=', 'case')
    .where('entity_id', '=', caseId)
    .orderBy('occurred_at', 'asc')
    .execute();

  return rows.map(toDomain);
}
