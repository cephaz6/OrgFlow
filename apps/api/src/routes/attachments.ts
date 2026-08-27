import { randomUUID } from 'node:crypto';

import {
  appendAuditEvent,
  countConfirmedAttachmentsForField,
  createAttachment,
  findAttachmentById,
  findCaseById,
  findProcessVersionById,
  generateId,
  markAttachmentConfirmed,
  softDeleteAttachment,
  withTenantTransaction,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import { findProcessDefinitionDocumentById, verifyDocumentIntegrity } from '@orgflow/documents';
import type { DomainEventPublisher } from '@orgflow/events';
import type { FileStore } from '@orgflow/storage';
import type {
  Attachment,
  Case,
  DomainEvent,
  FormField,
  ProcessDefinitionDocument,
} from '@orgflow/types';
import { Router } from 'express';
import type { Kysely, Transaction } from 'kysely';
import type { MongoClient } from 'mongodb';
import { z } from 'zod';

import { canViewCase } from '../cases/permissions.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { requireSession, sessionOf, type RequestSession } from '../middleware/require-session.js';

export interface AttachmentsDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  publisher: DomainEventPublisher;
  fileStore: FileStore;
  sessionSecret: string;
}

// TECH-STACK.md §4's own naming example. A platform ceiling regardless of
// what a field declares: a process owner who forgets to set
// validation.maxSizeBytes should not thereby uncap what their form accepts.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Presigned download URLs are short-lived and generated per request
// (PRD.md §16.2), never cached.
const DOWNLOAD_URL_EXPIRY_SECONDS = 15 * 60;

const presignUploadSchema = z.object({
  caseId: z.string().uuid(),
  fieldKey: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new HttpProblemError(400, 'Bad Request', detail);
  }
  return parsed.data;
}

function toResponse(attachment: Attachment) {
  return {
    attachmentId: attachment.attachmentId,
    caseId: attachment.caseId,
    fieldKey: attachment.fieldKey,
    filename: attachment.filename,
    declaredMimeType: attachment.declaredMimeType,
    sizeBytes: attachment.sizeBytes,
    scanStatus: attachment.scanStatus,
    uploadedByUserId: attachment.uploadedByUserId,
    confirmedAt: attachment.confirmedAt,
    createdAt: attachment.createdAt,
  };
}

function buildEvent(input: {
  eventType: DomainEvent['eventType'];
  organisationId: string;
  actorUserId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}): DomainEvent {
  return {
    eventId: randomUUID(),
    eventType: input.eventType,
    organisationId: input.organisationId,
    occurredAt: new Date().toISOString(),
    actorUserId: input.actorUserId,
    actorType: 'user',
    correlationId: input.correlationId,
    payload: input.payload,
    schemaVersion: 1,
  };
}

// Duplicated from cases.ts/tasks.ts rather than shared: both of those
// files already carry their own copy of this exact helper, and a case's
// pinned definition document is a small, self-contained lookup that does
// not warrant a cross-module dependency for one function.
async function loadPinnedDocument(
  trx: Transaction<Database>,
  mongoClient: MongoClient,
  organisationId: string,
  versionId: string,
): Promise<ProcessDefinitionDocument> {
  const version = await findProcessVersionById(trx, versionId);
  if (!version) {
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The case is pinned to a version that does not exist.',
    );
  }

  const document = await findProcessDefinitionDocumentById(
    mongoClient,
    organisationId,
    version.documentId,
  );

  if (!document) {
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The pinned version references a definition document that does not exist.',
    );
  }

  if (!verifyDocumentIntegrity(document, version.documentHash)) {
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The pinned definition document does not match the hash recorded when it was published.',
    );
  }

  return document;
}

function findFileField(document: ProcessDefinitionDocument, fieldKey: string): FormField {
  const field = document.form.sections
    .flatMap((section) => section.fields)
    .find((candidate) => candidate.key === fieldKey);

  if (!field) {
    throw new HttpProblemError(400, 'Bad Request', `No such field: ${fieldKey}.`);
  }
  if (field.type !== 'file') {
    throw new HttpProblemError(400, 'Bad Request', `Field ${fieldKey} does not accept files.`);
  }
  return field;
}

async function requireCase(trx: Transaction<Database>, caseId: string): Promise<Case> {
  const found = await findCaseById(trx, caseId);
  if (!found) {
    throw new HttpProblemError(404, 'Not Found', 'No such case.');
  }
  return found;
}

// Same reasoning as cases.ts's own requireVisibleCase: whether the case
// exists at all is not something a request outside its visibility should
// be able to distinguish from a permission refusal, so both come back as
// 404.
async function requireVisibleCase(
  trx: Transaction<Database>,
  session: RequestSession,
  caseId: string,
): Promise<Case> {
  const found = await requireCase(trx, caseId);
  if (!(await canViewCase(trx, session, found))) {
    throw new HttpProblemError(404, 'Not Found', 'No such case.');
  }
  return found;
}

// A `file` field only ever lives on the one intake form (PRD.md's
// definition document has no per-step forms), so the only two moments
// values, including attachments, can change are: the initial draft, and
// the window after a step returns the case to its requester for
// amendment (cases.ts's own /resubmit route uses this identical
// status/currentStepKey pair to recognise that window).
function requireEditableByRequester(found: Case, session: RequestSession): void {
  const editable =
    found.status === 'draft' || (found.status === 'active' && found.currentStepKey === null);
  if (!editable) {
    throw new HttpProblemError(
      409,
      'Conflict',
      `Attachments can only be added while a case is a draft or returned for amendment; this case is ${found.status}.`,
    );
  }
  if (found.submittedByUserId !== session.userId) {
    throw new HttpProblemError(
      403,
      'Forbidden',
      'Only the requester can add attachments to this case.',
    );
  }
}

function buildStorageKey(
  organisationId: string,
  caseId: string,
  attachmentId: string,
  filename: string,
): string {
  // TECH-STACK.md §5.3's convention, unchanged from the comment already on
  // the attachments table.
  return `${organisationId}/cases/${caseId}/${attachmentId}/${encodeURIComponent(filename)}`;
}

// PRD.md §16: presign, upload direct to S3, confirm, scan, download. Only
// the API-facing half lives here; the scan Lambda and the CDK bucket
// wiring are separate pieces of work, so a deployed environment without
// them still accepts uploads that simply never leave scanStatus 'pending'.
export function createAttachmentsRouter(deps: AttachmentsDeps): Router {
  const router = Router();

  router.use('/attachments', requireSession(deps.sessionSecret));
  // GOV-STANDARDS.md §6.4: rate-limit file upload endpoints specifically.
  // Applied via .use() rather than as a second argument to .post(), which
  // hits an Express 5 typings quirk: mixing a generic RequestHandler with
  // a path-typed handler in one route registration widens the inferred
  // params type from string to string | string[].
  router.use('/attachments/presign-upload', createRateLimiter());
  router.use('/attachments/:attachmentId/confirm', createRateLimiter());

  router.post('/attachments/presign-upload', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = parseBody(presignUploadSchema, req.body);

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const found = await requireVisibleCase(trx, session, body.caseId);
        requireEditableByRequester(found, session);

        const document = await loadPinnedDocument(
          trx,
          deps.mongoClient,
          session.organisationId,
          found.versionId,
        );
        const field = findFileField(document, body.fieldKey);
        const validation = field.type === 'file' ? field.validation : undefined;

        const maxSizeBytes = Math.min(
          validation?.maxSizeBytes ?? MAX_UPLOAD_BYTES,
          MAX_UPLOAD_BYTES,
        );
        if (body.sizeBytes > maxSizeBytes) {
          throw new HttpProblemError(
            400,
            'Bad Request',
            `This file is larger than the ${maxSizeBytes} byte limit for ${field.label}.`,
          );
        }

        if (
          validation?.acceptedMimeTypes &&
          validation.acceptedMimeTypes.length > 0 &&
          !validation.acceptedMimeTypes.includes(body.mimeType)
        ) {
          throw new HttpProblemError(
            400,
            'Bad Request',
            `${field.label} does not accept files of type ${body.mimeType}.`,
          );
        }

        if (validation?.maxFiles !== undefined) {
          const existing = await countConfirmedAttachmentsForField(
            trx,
            found.caseId,
            body.fieldKey,
          );
          if (existing >= validation.maxFiles) {
            throw new HttpProblemError(
              400,
              'Bad Request',
              `${field.label} accepts at most ${validation.maxFiles} file(s).`,
            );
          }
        }

        const attachmentId = generateId();
        const storageKey = buildStorageKey(
          session.organisationId,
          found.caseId,
          attachmentId,
          body.fileName,
        );

        const attachment = await createAttachment(trx, {
          attachmentId,
          organisationId: session.organisationId,
          caseId: found.caseId,
          fieldKey: body.fieldKey,
          filename: body.fileName,
          declaredMimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
          storageKey,
          uploadedByUserId: session.userId,
        });

        const presigned = await deps.fileStore.presignUpload({
          key: storageKey,
          contentType: body.mimeType,
          maxSizeBytes,
        });

        return { attachment, presigned };
      });

      res.status(201).json({
        attachment: toResponse(result.attachment),
        upload: result.presigned,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/attachments/:attachmentId/confirm', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const attachmentId = req.params.attachmentId!;
      const now = new Date();

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const attachment = await findAttachmentById(trx, attachmentId);
        if (!attachment || attachment.deletedAt) {
          throw new HttpProblemError(404, 'Not Found', 'No such attachment.');
        }

        const found = await requireVisibleCase(trx, session, attachment.caseId);
        requireEditableByRequester(found, session);

        if (attachment.uploadedByUserId !== session.userId) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only the person who started this upload can confirm it.',
          );
        }
        if (attachment.confirmedAt) {
          throw new HttpProblemError(409, 'Conflict', 'This attachment was already confirmed.');
        }

        const head = await deps.fileStore.headObject(attachment.storageKey);
        if (!head.exists) {
          throw new HttpProblemError(409, 'Conflict', 'The file has not finished uploading yet.');
        }

        const confirmed = await markAttachmentConfirmed(trx, attachmentId, now);

        await appendAuditEvent(trx, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          entityType: 'attachment',
          entityId: attachmentId,
          action: 'attachment.uploaded',
          correlationId: req.correlationId,
          payload: {
            caseId: found.caseId,
            fieldKey: confirmed.fieldKey,
            filename: confirmed.filename,
          },
        });

        return confirmed;
      });

      void deps.publisher
        .publish([
          buildEvent({
            eventType: 'attachment.uploaded',
            organisationId: session.organisationId,
            actorUserId: session.userId,
            correlationId: req.correlationId,
            payload: { attachmentId, caseId: result.caseId },
          }),
        ])
        .catch(() => {
          // Publish failures do not undo a committed confirmation; the
          // scan Lambda not being told about a new upload is a delivery
          // gap to notice from monitoring, not a reason to fail the
          // request that already succeeded.
        });

      res.status(200).json({ attachment: toResponse(result) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/attachments/:attachmentId/download', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const attachmentId = req.params.attachmentId!;

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const attachment = await findAttachmentById(trx, attachmentId);
        // PRD.md §16.2: 404 unless scanStatus is clean, no exceptions,
        // including for admins. A deleted or unscanned attachment gets the
        // identical response a nonexistent one would.
        if (!attachment || attachment.deletedAt || attachment.scanStatus !== 'clean') {
          throw new HttpProblemError(404, 'Not Found', 'No such attachment.');
        }

        const found = await requireVisibleCase(trx, session, attachment.caseId);

        await appendAuditEvent(trx, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          entityType: 'attachment',
          entityId: attachmentId,
          action: 'attachment.downloaded',
          correlationId: req.correlationId,
          payload: { caseId: found.caseId, filename: attachment.filename },
        });

        return attachment;
      });

      const url = await deps.fileStore.presignDownload(
        result.storageKey,
        DOWNLOAD_URL_EXPIRY_SECONDS,
      );

      res.status(200).json({ downloadUrl: url, filename: result.filename });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/attachments/:attachmentId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const attachmentId = req.params.attachmentId!;
      const now = new Date();

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const attachment = await findAttachmentById(trx, attachmentId);
        if (!attachment || attachment.deletedAt) {
          throw new HttpProblemError(404, 'Not Found', 'No such attachment.');
        }

        const found = await requireVisibleCase(trx, session, attachment.caseId);
        requireEditableByRequester(found, session);

        if (attachment.uploadedByUserId !== session.userId) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only the person who uploaded this file can remove it.',
          );
        }

        await appendAuditEvent(trx, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          entityType: 'attachment',
          entityId: attachmentId,
          action: 'attachment.deleted',
          correlationId: req.correlationId,
          payload: { caseId: found.caseId, filename: attachment.filename },
        });

        return softDeleteAttachment(trx, attachmentId, now);
      });

      // Best-effort: the row is already soft-deleted and will never be
      // served again regardless of whether the object itself is removed
      // from S3 promptly.
      deps.fileStore.deleteObject(result.storageKey).catch(() => {});

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
