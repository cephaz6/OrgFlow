import type { Attachment, AttachmentScanStatus } from '@orgflow/types';
import type { Selectable, Transaction } from 'kysely';

import type { AttachmentsTable, Database } from '../schema.js';

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
    deletedAt: row.deleted_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateAttachmentInput {
  // Supplied by the caller, not generated here: the route needs the id
  // before this row exists, to build the S3 storage key
  // ({organisationId}/cases/{caseId}/{attachmentId}/{filename}) that gets
  // passed to the presigned upload alongside it.
  attachmentId: string;
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
      attachment_id: input.attachmentId,
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

// Soft-deleted rows still arrive here: the confirm and download routes both
// need to tell "this attachment was deleted" apart from "this attachment
// never existed," which a filtered-out null would collapse into the same
// 404 either way.
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

// The case detail view's "attachments on this case" read: confirmed and
// not soft-deleted, since an abandoned presign or a removed file is not
// something to show alongside the case's answers.
export async function findConfirmedAttachmentsForCase(
  trx: Transaction<Database>,
  caseId: string,
): Promise<Attachment[]> {
  const rows = await trx
    .selectFrom('attachments')
    .selectAll()
    .where('case_id', '=', caseId)
    .where('confirmed_at', 'is not', null)
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'asc')
    .execute();

  return rows.map(toDomain);
}

// PRD.md §18's subject access export's attachment manifest: every file this
// user uploaded, including an abandoned or since-deleted one, since the
// export is a record of what this person did, not only what is currently
// live. Deliberately unpaginated, matching cases.ts's own reasoning for the
// same export.
export async function findAllAttachmentsUploadedByUser(
  trx: Transaction<Database>,
  userId: string,
): Promise<Attachment[]> {
  const rows = await trx
    .selectFrom('attachments')
    .selectAll()
    .where('uploaded_by_user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .execute();

  return rows.map(toDomain);
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
    .where('deleted_at', 'is', null)
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
  // Set only when the scan moves the object to a quarantine prefix
  // (PRD.md §16.1): the row must keep pointing at where the object
  // actually lives, or a later attempt to locate it (an ops tool, a
  // redaction job) would read a key nothing occupies any more.
  storageKey?: string;
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
      ...(input.storageKey !== undefined ? { storage_key: input.storageKey } : {}),
    })
    .where('attachment_id', '=', attachmentId)
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export async function softDeleteAttachment(
  trx: Transaction<Database>,
  attachmentId: string,
  deletedAt: Date,
): Promise<Attachment> {
  const row = await trx
    .updateTable('attachments')
    .set({ deleted_at: deletedAt, updated_at: new Date() })
    .where('attachment_id', '=', attachmentId)
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

// PRD.md §18's redaction: "attachments deleted". Distinct from
// softDeleteAttachment, which only hides an attachment a requester removed
// while editing a draft and leaves its filename intact, since that is not
// a privacy action. Redaction also blanks filename, which can itself carry
// personal data (a passport scan named after the person in it); field_key,
// scan_status and the timestamps stay, since they carry no personal
// content and are what lets the audit skeleton still say what kind of
// evidence used to be here.
export async function redactAttachment(
  trx: Transaction<Database>,
  attachmentId: string,
  redactedAt: Date,
): Promise<void> {
  await trx
    .updateTable('attachments')
    .set({ filename: '[REDACTED]', deleted_at: redactedAt, updated_at: new Date() })
    .where('attachment_id', '=', attachmentId)
    .execute();
}
