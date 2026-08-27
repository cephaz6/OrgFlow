import {
  appendAuditEvent,
  findAttachmentById,
  markAttachmentScanned,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import type { DomainEventPublisher } from '@orgflow/events';
import type { FileStore } from '@orgflow/storage';
import type { Attachment, AttachmentScanStatus, DomainEvent } from '@orgflow/types';
import { fileTypeFromBuffer } from 'file-type';
import type { Kysely } from 'kysely';

import type { Logger } from '../logger.js';
import { scanBytes } from './eicar-scanner.js';

export interface AttachmentScanDeps {
  db: Kysely<Database>;
  fileStore: FileStore;
  publisher: DomainEventPublisher;
  logger: Logger;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Handled by scanning inline in the same transaction as the write, unlike
// the notification consumer's separate claim table: there is no external
// side effect here to protect against duplicating (no email goes out), so
// the attachment row's own scan_status is a sufficient idempotency guard.
// A redelivery that arrives after this already ran finds scan_status no
// longer 'pending' and does nothing.
async function scanAndPersist(
  deps: AttachmentScanDeps,
  organisationId: string,
  attachmentId: string,
  correlationId: string,
): Promise<Attachment | null> {
  return withTenantTransaction(deps.db, organisationId, async (trx) => {
    const attachment = await findAttachmentById(trx, attachmentId);

    // Cross-tenant reads arrive as null (RLS hides them), a deleted
    // attachment is one nobody can download regardless of scan outcome,
    // and an already-scanned one is exactly the redelivery case above.
    // All three are a no-op for the identical reason: there is nothing
    // this handler still needs to do.
    if (!attachment || attachment.deletedAt || attachment.scanStatus !== 'pending') {
      return null;
    }

    const bytes = await deps.fileStore.getObjectBytes(attachment.storageKey, attachment.sizeBytes);
    const sniffed = await fileTypeFromBuffer(bytes);
    const outcome: AttachmentScanStatus = scanBytes(bytes);
    const scannedAt = new Date();

    const storageKey =
      outcome === 'infected'
        ? await deps.fileStore.moveToQuarantine(attachment.storageKey)
        : undefined;

    const scanned = await markAttachmentScanned(trx, attachmentId, {
      scanStatus: outcome,
      sniffedMimeType: sniffed?.mime ?? null,
      scannedAt,
      ...(storageKey !== undefined ? { storageKey } : {}),
    });

    // GOV-STANDARDS.md §6.5: every state change is an audit event, and an
    // infected upload in particular is exactly the kind of event PRD.md
    // §16.1 says must be recorded ("an audit event is written").
    await appendAuditEvent(trx, {
      organisationId,
      actorUserId: null,
      actorType: 'system',
      entityType: 'attachment',
      entityId: attachmentId,
      action: outcome === 'infected' ? 'attachment.infected' : 'attachment.scanned',
      correlationId,
      payload: { caseId: attachment.caseId, scanStatus: outcome },
    });

    return scanned;
  });
}

export async function handleAttachmentUploaded(
  deps: AttachmentScanDeps,
  event: DomainEvent,
): Promise<{ scanned: boolean }> {
  const organisationId = event.organisationId;
  const attachmentId = readString(event.payload, 'attachmentId');

  if (!organisationId || !attachmentId) {
    deps.logger.warn(
      { eventId: event.eventId, eventType: event.eventType },
      'attachment.uploaded event carried no organisationId or attachmentId; ignoring',
    );
    return { scanned: false };
  }

  const scanned = await scanAndPersist(deps, organisationId, attachmentId, event.correlationId);
  if (!scanned) {
    return { scanned: false };
  }

  // Logged rather than thrown on failure, the same reasoning
  // apps/api/src/routes/cases.ts's publishOrLog already applies: the scan
  // itself already committed, so rethrowing here would cause SQS to
  // redeliver this message, and the redelivery's idempotency check above
  // (scan_status no longer 'pending') would silently skip straight past
  // the one thing a retry would actually need to finish, this publish.
  // Losing the event to a logged warning is a smaller failure than losing
  // it permanently to a retry that can never reach this line again.
  try {
    await deps.publisher.publish([
      {
        eventId: `${event.eventId}-scanned`,
        eventType: 'attachment.scanned',
        organisationId,
        occurredAt: scanned.scannedAt ?? new Date().toISOString(),
        actorUserId: null,
        actorType: 'system',
        correlationId: event.correlationId,
        payload: { attachmentId, scanStatus: scanned.scanStatus },
        schemaVersion: 1,
      },
    ]);
  } catch (err) {
    deps.logger.error(
      { err, attachmentId, scanStatus: scanned.scanStatus },
      'attachment.scanned was not published after the scan committed',
    );
  }

  return { scanned: true };
}
