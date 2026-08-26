import type { Attachment, AttachmentScanStatus } from '@orgflow/types';
import type { Selectable, Transaction } from 'kysely';

import type { AttachmentsTable, Database } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<AttachmentsTable>): Attachment {
  return {
    attachmentId: row.attachment_id,
    organisationId: row.organisation_id,
    caseId: row.case_id,
    fieldKey: row.field_key,
    filename: row.filename,
    declaredMimeType: row.declared_mime_type,
    sniffedMimeType: row.sniffed_mime_type,
    // BIGINT arrives as a string from node-postgres; a single upload is far
    // below Number.MAX_SAFE_INTEGER.
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    scanStatus: row.scan_status as AttachmentScanStatus,
    uploadedByUserId: row.uploaded_by_user_id,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    scannedAt: row.scanned_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateAttachmentInput {
  organisationId: string;
  caseId: string;
  fieldKey: string;
  filename: string;
  declaredMimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedByUserId: string;
}

export async function createAttachment(
  trx: Transaction<Database>,
  input: CreateAttachmentInput,
): Promise<Attachment> {
  const row = await trx
    .insertInto('attachments')
    .values({
      attachment_id: generateId(),
      organisation_id: input.organisationId,
      case_id: input.caseId,
      field_key: input.fieldKey,
      filename: input.filename,
      declared_mime_type: input.declaredMimeType,
      size_bytes: String(input.sizeBytes),
      storage_key: input.storageKey,
      uploaded_by_user_id: input.uploadedByUserId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export async function findAttachmentById(
  trx: Transaction<Database>,
  attachmentId: string,
): Promise<Attachment | null> {
  const row = await trx
    .selectFrom('attachments')
    .selectAll()
    .where('attachment_id', '=', attachmentId)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

// A field's declared maxFiles counts confirmed uploads only: an abandoned
// presign that was never confirmed should not consume the limit, the same
// reasoning a draft case row does not count against anything until
// submitted.
export async function countConfirmedAttachmentsForField(
  trx: Transaction<Database>,
  caseId: string,
  fieldKey: string,
): Promise<number> {
  const row = await trx
    .selectFrom('attachments')
    .select(({ fn }) => fn.countAll().as('count'))
    .where('case_id', '=', caseId)
    .where('field_key', '=', fieldKey)
    .where('confirmed_at', 'is not', null)
    .executeTakeFirstOrThrow();

  return Number(row.count);
}

export async function markAttachmentConfirmed(
  trx: Transaction<Database>,
  attachmentId: string,
  confirmedAt: Date,
): Promise<Attachment> {
  const row = await trx
    .updateTable('attachments')
    .set({ confirmed_at: confirmedAt, updated_at: new Date() })
    .where('attachment_id', '=', attachmentId)
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export interface MarkAttachmentScannedInput {
  scanStatus: AttachmentScanStatus;
  sniffedMimeType: string | null;
  scannedAt: Date;
}

export async function markAttachmentScanned(
  trx: Transaction<Database>,
  attachmentId: string,
  input: MarkAttachmentScannedInput,
): Promise<Attachment> {
  const row = await trx
    .updateTable('attachments')
    .set({
      scan_status: input.scanStatus,
      sniffed_mime_type: input.sniffedMimeType,
      scanned_at: input.scannedAt,
      updated_at: new Date(),
    })
    .where('attachment_id', '=', attachmentId)
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}
