import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  countConfirmedAttachmentsForField,
  createAttachment,
  findAttachmentById,
  findConfirmedAttachmentsForCase,
  markAttachmentConfirmed,
  markAttachmentScanned,
  softDeleteAttachment,
} from './repositories/attachments.js';
import { createCase } from './repositories/cases.js';
import { createOrganisation } from './repositories/organisations.js';
import {
  createProcessDefinition,
  createProcessVersion,
  publishProcessVersion,
} from './repositories/process-definitions.js';
import { createUserWithIdentity } from './repositories/users.js';
import { createDb } from './connection.js';
import type { Database } from './schema.js';
import { withTenantTransaction } from './tenant-transaction.js';
import { generateId } from './uuid.js';

// Mirrors sla-and-delegations.integration.test.ts's seedTenant: a whole
// tenant's worth of fixtures, created on the unscoped connection, so the
// test can prove two tenants cannot see each other's attachments.
async function seedTenant(db: Kysely<Database>, label: string) {
  const user = await createUserWithIdentity(db, {
    email: `${label}-${generateId()}@example.invalid`,
    displayName: `${label} user`,
    issuer: 'urn:orgflow:test',
    subject: `${label}-${generateId()}`,
  });

  const organisation = await createOrganisation(db, {
    name: `${label} tenant`,
    slug: `${label}-${generateId()}`,
    createdByUserId: user.userId,
  });

  const caseRow = await withTenantTransaction(db, organisation.organisationId, async (trx) => {
    const definition = await createProcessDefinition(trx, {
      organisationId: organisation.organisationId,
      key: `expense-${generateId()}`,
      name: 'Expense claim',
      referencePrefix: 'EXP',
      createdByUserId: user.userId,
    });

    const version = await createProcessVersion(trx, {
      organisationId: organisation.organisationId,
      definitionId: definition.definitionId,
      versionNumber: 1,
      documentId: `doc-${generateId()}`,
      documentHash: 'sha256-placeholder',
    });
    await publishProcessVersion(trx, version.versionId, user.userId);

    return createCase(trx, {
      organisationId: organisation.organisationId,
      definitionId: definition.definitionId,
      versionId: version.versionId,
      title: 'A claim',
      submittedByUserId: user.userId,
    });
  });

  return { user, organisation, caseRow };
}

describe('attachments repository against real Postgres', () => {
  let db: Kysely<Database>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let tenantB: Awaited<ReturnType<typeof seedTenant>>;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    tenantA = await seedTenant(db, 'attachments-tenant-a');
    tenantB = await seedTenant(db, 'attachments-tenant-b');
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates a pending attachment and reads it back', async () => {
    const created = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      createAttachment(trx, {
        attachmentId: generateId(),
        organisationId: tenantA.organisation.organisationId,
        caseId: tenantA.caseRow.caseId,
        fieldKey: 'quote',
        filename: 'quote.pdf',
        declaredMimeType: 'application/pdf',
        sizeBytes: 2_048,
        storageKey: `${tenantA.organisation.organisationId}/cases/${tenantA.caseRow.caseId}/att/quote.pdf`,
        uploadedByUserId: tenantA.user.userId,
      }),
    );

    expect(created.scanStatus).toBe('pending');
    expect(created.confirmedAt).toBeNull();
    expect(created.sizeBytes).toBe(2_048);

    const found = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      findAttachmentById(trx, created.attachmentId),
    );
    expect(found?.attachmentId).toBe(created.attachmentId);
  });

  it('hides organisation A attachments from a session scoped to organisation B', async () => {
    const created = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      createAttachment(trx, {
        attachmentId: generateId(),
        organisationId: tenantA.organisation.organisationId,
        caseId: tenantA.caseRow.caseId,
        fieldKey: 'quote',
        filename: 'hidden.pdf',
        declaredMimeType: 'application/pdf',
        sizeBytes: 1_024,
        storageKey: `${tenantA.organisation.organisationId}/cases/${tenantA.caseRow.caseId}/att/hidden.pdf`,
        uploadedByUserId: tenantA.user.userId,
      }),
    );

    const foundByB = await withTenantTransaction(db, tenantB.organisation.organisationId, (trx) =>
      findAttachmentById(trx, created.attachmentId),
    );

    expect(foundByB).toBeNull();
  });

  it('rejects inserting an attachment for organisation B while scoped to organisation A', async () => {
    await expect(
      withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
        createAttachment(trx, {
          attachmentId: generateId(),
          organisationId: tenantB.organisation.organisationId,
          caseId: tenantB.caseRow.caseId,
          fieldKey: 'quote',
          filename: 'cross-tenant.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: 1,
          storageKey: 'irrelevant',
          uploadedByUserId: tenantB.user.userId,
        }),
      ),
    ).rejects.toThrow();
  });

  it('counts only confirmed attachments toward a field, not abandoned presigns', async () => {
    const fieldKey = `receipts-${generateId()}`;

    const pending = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      createAttachment(trx, {
        attachmentId: generateId(),
        organisationId: tenantA.organisation.organisationId,
        caseId: tenantA.caseRow.caseId,
        fieldKey,
        filename: 'never-confirmed.pdf',
        declaredMimeType: 'application/pdf',
        sizeBytes: 10,
        storageKey: 'irrelevant-1',
        uploadedByUserId: tenantA.user.userId,
      }),
    );
    const confirmed = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      createAttachment(trx, {
        attachmentId: generateId(),
        organisationId: tenantA.organisation.organisationId,
        caseId: tenantA.caseRow.caseId,
        fieldKey,
        filename: 'confirmed.pdf',
        declaredMimeType: 'application/pdf',
        sizeBytes: 10,
        storageKey: 'irrelevant-2',
        uploadedByUserId: tenantA.user.userId,
      }),
    );

    await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      markAttachmentConfirmed(trx, confirmed.attachmentId, new Date()),
    );

    const count = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      countConfirmedAttachmentsForField(trx, tenantA.caseRow.caseId, fieldKey),
    );

    expect(count).toBe(1);
    expect(pending.confirmedAt).toBeNull();
  });

  it('records the scan outcome, including the sniffed mime type', async () => {
    const created = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      createAttachment(trx, {
        attachmentId: generateId(),
        organisationId: tenantA.organisation.organisationId,
        caseId: tenantA.caseRow.caseId,
        fieldKey: 'quote',
        filename: 'scan-me.bin',
        declaredMimeType: 'application/octet-stream',
        sizeBytes: 4,
        storageKey: 'irrelevant-3',
        uploadedByUserId: tenantA.user.userId,
      }),
    );

    const scanned = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      markAttachmentScanned(trx, created.attachmentId, {
        scanStatus: 'clean',
        sniffedMimeType: 'application/pdf',
        scannedAt: new Date(),
      }),
    );

    expect(scanned.scanStatus).toBe('clean');
    expect(scanned.sniffedMimeType).toBe('application/pdf');
    expect(scanned.scannedAt).not.toBeNull();
  });

  it('excludes a soft-deleted attachment from the field count and the case list, but not by id', async () => {
    const fieldKey = `deletable-${generateId()}`;

    const created = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      createAttachment(trx, {
        attachmentId: generateId(),
        organisationId: tenantA.organisation.organisationId,
        caseId: tenantA.caseRow.caseId,
        fieldKey,
        filename: 'to-be-deleted.pdf',
        declaredMimeType: 'application/pdf',
        sizeBytes: 10,
        storageKey: 'irrelevant-4',
        uploadedByUserId: tenantA.user.userId,
      }),
    );
    await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      markAttachmentConfirmed(trx, created.attachmentId, new Date()),
    );

    const beforeDelete = await withTenantTransaction(
      db,
      tenantA.organisation.organisationId,
      (trx) => findConfirmedAttachmentsForCase(trx, tenantA.caseRow.caseId),
    );
    expect(beforeDelete.some((a) => a.attachmentId === created.attachmentId)).toBe(true);

    const deleted = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      softDeleteAttachment(trx, created.attachmentId, new Date()),
    );
    expect(deleted.deletedAt).not.toBeNull();

    const count = await withTenantTransaction(db, tenantA.organisation.organisationId, (trx) =>
      countConfirmedAttachmentsForField(trx, tenantA.caseRow.caseId, fieldKey),
    );
    expect(count).toBe(0);

    const afterDelete = await withTenantTransaction(
      db,
      tenantA.organisation.organisationId,
      (trx) => findConfirmedAttachmentsForCase(trx, tenantA.caseRow.caseId),
    );
    expect(afterDelete.some((a) => a.attachmentId === created.attachmentId)).toBe(false);

    // findAttachmentById still returns it: the download route needs to
    // distinguish "deleted" from "never existed" (both 404 to the caller,
    // but for different reasons, and only one of them is worth logging).
    const stillFindableById = await withTenantTransaction(
      db,
      tenantA.organisation.organisationId,
      (trx) => findAttachmentById(trx, created.attachmentId),
    );
    expect(stillFindableById?.attachmentId).toBe(created.attachmentId);
  });
});
