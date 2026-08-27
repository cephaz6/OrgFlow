import { createDb, markAttachmentScanned, withTenantTransaction, type Database } from '@orgflow/db';
import { createMongoClient, ensureIndexes } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyPublisher, type DummyDomainEventPublisher } from '@orgflow/events';
import { createDummyFileStore, type DummyFileStore } from '@orgflow/storage';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { createLogger } from '../logger.js';

const SESSION_SECRET = '55'.repeat(32);

// Cross-tenant isolation for the attachments table is already proven at
// the repository layer (packages/db/src/attachments.integration.test.ts,
// via RLS); this file is about the route behaviour on top of it: the
// editable-window rule, the field's declared constraints, and the
// clean-scan gate on download.
describe('attachments API against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;
  let publisher: DummyDomainEventPublisher;
  let fileStore: DummyFileStore;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
    await ensureIndexes(mongoClient);
    publisher = createDummyPublisher();
  });

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  beforeEach(() => {
    publisher.clear();
    fileStore = createDummyFileStore();
  });

  function buildApp() {
    return createApp({
      db,
      mongoClient,
      publisher,
      emailSender: createDummyEmailSender(),
      fileStore,
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  async function signInAsDevUser(app: ReturnType<typeof buildApp>) {
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/dev-login');
    expect(login.status).toBe(200);
    return agent;
  }

  async function signInAsManager(app: ReturnType<typeof buildApp>) {
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/dev-login').send({ as: 'manager' });
    expect(login.status).toBe(200);
    return agent;
  }

  async function definitionId(agent: ReturnType<typeof request.agent>): Promise<string> {
    const response = await agent.get('/api/v1/process-definitions');
    expect(response.status).toBe(200);
    const laptop = response.body.data.find(
      (entry: { key: string }) => entry.key === 'laptop-request',
    );
    return laptop.definitionId as string;
  }

  async function createDraft(agent: ReturnType<typeof request.agent>): Promise<string> {
    const response = await agent.post('/api/v1/cases').send({
      definitionId: await definitionId(agent),
      values: {
        laptopModel: 'mbp14',
        estimatedCost: 1_500,
        justification: 'The current machine no longer builds the project within a working day.',
        requiredBy: '2026-12-01',
      },
    });
    expect(response.status).toBe(201);
    return response.body.case.caseId as string;
  }

  async function sessionOrganisationId(agent: ReturnType<typeof request.agent>): Promise<string> {
    const session = await agent.get('/api/v1/auth/session');
    expect(session.status).toBe(200);
    return session.body.organisationId as string;
  }

  it('presigns an upload against the field’s own declared constraints', async () => {
    const app = buildApp();
    const agent = await signInAsDevUser(app);
    const caseId = await createDraft(agent);

    const oversized = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'quote',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      // The seeded field's own maxSizeBytes (packages/documents/src/seed/laptop-request.ts) is 10485760.
      sizeBytes: 10_485_761,
    });
    expect(oversized.status).toBe(400);

    const wrongType = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'quote',
      fileName: 'quote.exe',
      mimeType: 'application/x-msdownload',
      sizeBytes: 1_024,
    });
    expect(wrongType.status).toBe(400);

    const accepted = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'quote',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.attachment.scanStatus).toBe('pending');
    expect(accepted.body.upload.url).toBeTruthy();
  });

  it('refuses a field that does not accept files', async () => {
    const app = buildApp();
    const agent = await signInAsDevUser(app);
    const caseId = await createDraft(agent);

    const response = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'justification',
      fileName: 'note.txt',
      mimeType: 'text/plain',
      sizeBytes: 10,
    });
    expect(response.status).toBe(400);
  });

  it('refuses to presign once the case has left the draft window', async () => {
    const app = buildApp();
    const agent = await signInAsDevUser(app);
    const caseId = await createDraft(agent);

    const submitted = await agent.post(`/api/v1/cases/${caseId}/submit`);
    expect(submitted.status).toBe(200);

    const response = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'quote',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
    });
    expect(response.status).toBe(409);
  });

  it('refuses to confirm before the object has actually landed in the store', async () => {
    const app = buildApp();
    const agent = await signInAsDevUser(app);
    const caseId = await createDraft(agent);

    const presigned = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'quote',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
    });
    expect(presigned.status).toBe(201);

    const tooEarly = await agent.post(
      `/api/v1/attachments/${presigned.body.attachment.attachmentId}/confirm`,
    );
    expect(tooEarly.status).toBe(409);
  });

  it('confirms an upload once the object exists, and lists it on the case', async () => {
    const app = buildApp();
    const agent = await signInAsDevUser(app);
    const caseId = await createDraft(agent);

    const presigned = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'quote',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
    });
    expect(presigned.status).toBe(201);
    const attachmentId = presigned.body.attachment.attachmentId as string;
    const storageKey = presigned.body.upload.fields.key as string;

    // Simulates the client's own direct-to-S3 upload, exactly as
    // DummyFileStore's own doc comment describes it being used for.
    fileStore.objects.set(storageKey, { bytes: Buffer.from('%PDF'), sizeBytes: 4 });

    const confirmed = await agent.post(`/api/v1/attachments/${attachmentId}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.attachment.confirmedAt).toBeTruthy();

    const events = publisher.published;
    expect(events.some((event) => event.eventType === 'attachment.uploaded')).toBe(true);

    const caseDetail = await agent.get(`/api/v1/cases/${caseId}`);
    expect(caseDetail.status).toBe(200);
    expect(
      caseDetail.body.attachments.some(
        (a: { attachmentId: string }) => a.attachmentId === attachmentId,
      ),
    ).toBe(true);
  });

  it('404s a download until the scan comes back clean, then serves it to anyone who can view the case', async () => {
    const app = buildApp();
    const agent = await signInAsDevUser(app);
    const caseId = await createDraft(agent);
    const organisationId = await sessionOrganisationId(agent);

    const presigned = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'quote',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
    });
    const attachmentId = presigned.body.attachment.attachmentId as string;
    const storageKey = presigned.body.upload.fields.key as string;
    fileStore.objects.set(storageKey, { bytes: Buffer.from('%PDF'), sizeBytes: 4 });
    await agent.post(`/api/v1/attachments/${attachmentId}/confirm`);

    const beforeScan = await agent.get(`/api/v1/attachments/${attachmentId}/download`);
    expect(beforeScan.status).toBe(404);

    await withTenantTransaction(db, organisationId, (trx) =>
      markAttachmentScanned(trx, attachmentId, {
        scanStatus: 'clean',
        sniffedMimeType: 'application/pdf',
        scannedAt: new Date(),
      }),
    );

    const afterScan = await agent.get(`/api/v1/attachments/${attachmentId}/download`);
    expect(afterScan.status).toBe(200);
    expect(afterScan.body.downloadUrl).toBeTruthy();

    // The line manager can see the requester's case (canViewCase, once
    // there is an open task assigned to them) and so can download the
    // same attachment; visibility here is not limited to the uploader.
    const submitted = await agent.post(`/api/v1/cases/${caseId}/submit`);
    expect(submitted.status).toBe(200);
    const managerAgent = await signInAsManager(app);
    const asManager = await managerAgent.get(`/api/v1/attachments/${attachmentId}/download`);
    expect(asManager.status).toBe(200);
  });

  it('never serves an infected attachment', async () => {
    const app = buildApp();
    const agent = await signInAsDevUser(app);
    const caseId = await createDraft(agent);
    const organisationId = await sessionOrganisationId(agent);

    const presigned = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'quote',
      fileName: 'eicar.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
    });
    const attachmentId = presigned.body.attachment.attachmentId as string;
    const storageKey = presigned.body.upload.fields.key as string;
    fileStore.objects.set(storageKey, { bytes: Buffer.from('%PDF'), sizeBytes: 4 });
    await agent.post(`/api/v1/attachments/${attachmentId}/confirm`);

    await withTenantTransaction(db, organisationId, (trx) =>
      markAttachmentScanned(trx, attachmentId, {
        scanStatus: 'infected',
        sniffedMimeType: 'application/pdf',
        scannedAt: new Date(),
      }),
    );

    const response = await agent.get(`/api/v1/attachments/${attachmentId}/download`);
    expect(response.status).toBe(404);
  });

  it('soft-deletes an attachment, removing it from the case and from confirmation', async () => {
    const app = buildApp();
    const agent = await signInAsDevUser(app);
    const caseId = await createDraft(agent);

    const presigned = await agent.post('/api/v1/attachments/presign-upload').send({
      caseId,
      fieldKey: 'quote',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
    });
    const attachmentId = presigned.body.attachment.attachmentId as string;
    const storageKey = presigned.body.upload.fields.key as string;
    fileStore.objects.set(storageKey, { bytes: Buffer.from('%PDF'), sizeBytes: 4 });
    await agent.post(`/api/v1/attachments/${attachmentId}/confirm`);

    const deleted = await agent.delete(`/api/v1/attachments/${attachmentId}`);
    expect(deleted.status).toBe(204);

    const caseDetail = await agent.get(`/api/v1/cases/${caseId}`);
    expect(
      caseDetail.body.attachments.some(
        (a: { attachmentId: string }) => a.attachmentId === attachmentId,
      ),
    ).toBe(false);

    const againDelete = await agent.delete(`/api/v1/attachments/${attachmentId}`);
    expect(againDelete.status).toBe(404);
  });
});
