import {
  createAttachment,
  createCase,
  createDb,
  createOrganisation,
  createProcessDefinition,
  createProcessVersion,
  createUserWithIdentity,
  findAttachmentById,
  generateId,
  insertOrganisationMember,
  publishProcessVersion,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createDummyPublisher, type DummyDomainEventPublisher } from '@orgflow/events';
import { createDummyFileStore, type DummyFileStore } from '@orgflow/storage';
import type { DomainEvent } from '@orgflow/types';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dispatchAttachmentScanEvent } from './attachment-scan/dispatch.js';
import {
  handleAttachmentUploaded,
  type AttachmentScanDeps,
} from './attachment-scan/handle-attachment-uploaded.js';
import { createLogger } from './logger.js';

// The exact standard test string this scanner looks for
// (https://www.eicar.org/download-anti-malware-testfile/); not a real
// virus, and the same string a real ClamAV engine also recognises.
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
// A minimal PDF header, enough for file-type to identify it. A bare PNG
// magic-number prefix is not: file-type's PNG check reads past the 8-byte
// signature into the file's own chunk structure, which a signature alone
// does not have.
const PDF_BYTES = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');

describe('attachment scan worker against real Postgres', () => {
  let db: Kysely<Database>;
  let fileStore: DummyFileStore;
  let publisher: DummyDomainEventPublisher;

  let organisationId: string;
  let userId: string;
  let caseId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });

    const user = await createUserWithIdentity(db, {
      email: `scan-${generateId()}@example.invalid`,
      displayName: 'Scan Tester',
      issuer: 'urn:orgflow:test',
      subject: `scan-${generateId()}`,
    });
    userId = user.userId;

    const organisation = await createOrganisation(db, {
      name: 'Scanning tenant',
      slug: `scan-${generateId()}`,
      createdByUserId: userId,
    });
    organisationId = organisation.organisationId;

    await withTenantTransaction(db, organisationId, async (trx) => {
      await insertOrganisationMember(trx, { organisationId, userId, roles: ['member'] });

      const definition = await createProcessDefinition(trx, {
        organisationId,
        key: 'laptop-request',
        name: 'Laptop request',
        referencePrefix: 'LAP',
        createdByUserId: userId,
      });

      const version = await createProcessVersion(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionNumber: 1,
        documentId: `doc-${generateId()}`,
        documentHash: 'sha256-placeholder',
      });
      await publishProcessVersion(trx, version.versionId, userId);

      const draft = await createCase(trx, {
        organisationId,
        definitionId: definition.definitionId,
        versionId: version.versionId,
        title: 'A laptop, for scanning purposes',
        submittedByUserId: userId,
      });
      caseId = draft.caseId;
    });
  }, 60_000);

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    fileStore = createDummyFileStore();
    publisher = createDummyPublisher();
  });

  function deps(): AttachmentScanDeps {
    return { db, fileStore, publisher, logger: createLogger('silent') };
  }

  // A pending attachment row plus the bytes it points at, exactly as
  // presign-upload + confirm would have left it: confirmed, unscanned,
  // and the object actually present in the store.
  async function seedPendingAttachment(bytes: Buffer, filename: string) {
    const attachmentId = generateId();
    const storageKey = `${organisationId}/cases/${caseId}/${attachmentId}/${filename}`;

    const attachment = await withTenantTransaction(db, organisationId, (trx) =>
      createAttachment(trx, {
        attachmentId,
        organisationId,
        caseId,
        fieldKey: 'quote',
        filename,
        declaredMimeType: 'application/octet-stream',
        sizeBytes: bytes.length,
        storageKey,
        uploadedByUserId: userId,
      }),
    );

    fileStore.objects.set(storageKey, { bytes, sizeBytes: bytes.length });
    return attachment;
  }

  function uploadedEvent(attachmentId: string, overrides: Partial<DomainEvent> = {}): DomainEvent {
    return {
      eventId: `event-${generateId()}`,
      eventType: 'attachment.uploaded',
      organisationId,
      occurredAt: new Date().toISOString(),
      actorUserId: userId,
      actorType: 'user',
      correlationId: `correlation-${generateId()}`,
      payload: { attachmentId, caseId },
      schemaVersion: 1,
      ...overrides,
    };
  }

  it('marks a clean upload clean, and records the sniffed mime type', async () => {
    const attachment = await seedPendingAttachment(PDF_BYTES, 'quote.pdf');

    const result = await handleAttachmentUploaded(deps(), uploadedEvent(attachment.attachmentId));
    expect(result.scanned).toBe(true);

    const found = await withTenantTransaction(db, organisationId, (trx) =>
      findAttachmentById(trx, attachment.attachmentId),
    );
    expect(found?.scanStatus).toBe('clean');
    expect(found?.sniffedMimeType).toBe('application/pdf');
    expect(found?.storageKey).toBe(attachment.storageKey);

    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]).toMatchObject({
      eventType: 'attachment.scanned',
      payload: { attachmentId: attachment.attachmentId, scanStatus: 'clean' },
    });
  });

  it('quarantines an EICAR upload and never leaves it at scanStatus pending', async () => {
    const attachment = await seedPendingAttachment(Buffer.from(EICAR, 'latin1'), 'invoice.pdf');

    const result = await handleAttachmentUploaded(deps(), uploadedEvent(attachment.attachmentId));
    expect(result.scanned).toBe(true);

    const found = await withTenantTransaction(db, organisationId, (trx) =>
      findAttachmentById(trx, attachment.attachmentId),
    );
    expect(found?.scanStatus).toBe('infected');
    // Moved, not left where the original upload landed: a later download
    // attempt (already 404ing on scanStatus alone) should also find
    // nothing at the pre-quarantine key.
    expect(found?.storageKey).not.toBe(attachment.storageKey);
    expect(found?.storageKey).toMatch(/^quarantine\//);
    expect(fileStore.objects.has(attachment.storageKey)).toBe(false);

    expect(publisher.published[0]).toMatchObject({
      eventType: 'attachment.scanned',
      payload: { attachmentId: attachment.attachmentId, scanStatus: 'infected' },
    });
  });

  it('does not rescan or re-publish on a redelivered event', async () => {
    const attachment = await seedPendingAttachment(PDF_BYTES, 'quote.pdf');
    const event = uploadedEvent(attachment.attachmentId);

    const first = await handleAttachmentUploaded(deps(), event);
    const second = await handleAttachmentUploaded(deps(), event);

    expect(first.scanned).toBe(true);
    expect(second.scanned).toBe(false);
    expect(publisher.published).toHaveLength(1);
  });

  it('does nothing for an attachment that does not exist', async () => {
    const result = await handleAttachmentUploaded(deps(), uploadedEvent(generateId()));
    expect(result.scanned).toBe(false);
    expect(publisher.published).toHaveLength(0);
  });

  it('ignores an event type it has no handler for, through the dispatch table', async () => {
    const result = await dispatchAttachmentScanEvent(deps(), {
      eventId: `event-${generateId()}`,
      eventType: 'case.submitted',
      organisationId,
      occurredAt: new Date().toISOString(),
      actorUserId: userId,
      actorType: 'user',
      correlationId: `correlation-${generateId()}`,
      payload: {},
      schemaVersion: 1,
    });
    expect(result.handled).toBe(false);
  });
});
