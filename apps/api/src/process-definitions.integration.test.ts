import {
  createDb,
  createOrganisation,
  createUserWithIdentity,
  ensureGroup,
  ensureGroupMember,
  generateId,
  insertOrganisationMember,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { createMongoClient, ensureIndexes } from '@orgflow/documents';
import { createDummyEmailSender } from '@orgflow/email';
import { createDummyFileStore } from '@orgflow/storage';
import { createDummyPublisher } from '@orgflow/events';
import type { OrganisationRole } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { buildSessionClaims, createSessionToken, SESSION_COOKIE_NAME } from './auth/session.js';
import { createLogger } from './logger.js';

const SESSION_SECRET = '55'.repeat(32);

// PRD.md §13.2's form builder: create, load, edit and publish a process
// definition's draft. Exercised against real Postgres and Mongo, per
// CLAUDE.md's rule against mocking the database in integration tests.
describe('process definitions write API against real Postgres and Mongo', () => {
  let db: Kysely<Database>;
  let mongoClient: MongoClient;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    mongoClient = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
    await ensureIndexes(mongoClient);
  });

  afterAll(async () => {
    await db.destroy();
    await mongoClient.close();
  });

  function buildApp() {
    return createApp({
      db,
      mongoClient,
      publisher: createDummyPublisher(),
      emailSender: createDummyEmailSender(),
      fileStore: createDummyFileStore(),
      corsOrigin: 'http://localhost:3000',
      logger: createLogger('silent'),
      sessionSecret: SESSION_SECRET,
      isLocal: true,
      apiBaseUrl: 'http://localhost:4000',
    });
  }

  // A fresh organisation with one member holding the given roles, signed
  // in. Each test gets its own organisation so definition keys and
  // ownership checks never collide between tests.
  async function buildMember(roles: OrganisationRole[], organisationId?: string) {
    const user = await createUserWithIdentity(db, {
      email: `${generateId()}@example.invalid`,
      displayName: 'Test member',
      issuer: 'urn:orgflow:test',
      subject: generateId(),
    });

    const orgId =
      organisationId ??
      (
        await createOrganisation(db, {
          name: `org-${generateId()}`,
          slug: `org-${generateId()}`,
          createdByUserId: user.userId,
        })
      ).organisationId;

    await withTenantTransaction(db, orgId, (trx) =>
      insertOrganisationMember(trx, { organisationId: orgId, userId: user.userId, roles }),
    );

    const token = await createSessionToken(
      SESSION_SECRET,
      buildSessionClaims(user.userId, orgId, roles),
    );

    return {
      userId: user.userId,
      organisationId: orgId,
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    };
  }

  // referencePrefix must be letters only (createProcessDefinitionBodySchema's
  // regex), so generateId()'s hex characters cannot be used directly the way
  // other unique-enough-string needs in this file do.
  let prefixCounter = 0;
  function letterPrefix(): string {
    prefixCounter += 1;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return `X${letters[prefixCounter % 26]}${letters[Math.floor(prefixCounter / 26) % 26]}`;
  }

  function createBody(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      name: `Expense claim ${generateId()}`,
      description: 'Reimburse a work expense.',
      category: 'Finance',
      referencePrefix: 'EXP',
      ...overrides,
    };
  }

  it('creates a definition with a bootstrap draft the engine can already run', async () => {
    const owner = await buildMember(['processOwner']);
    const app = buildApp();

    const response = await request(app)
      .post('/api/v1/process-definitions')
      .set('Cookie', owner.cookie)
      .send(createBody());

    expect(response.status).toBe(201);
    expect(response.body.definition.status).toBe('draft');
    expect(response.body.version).toMatchObject({ versionNumber: 1, status: 'draft' });
    expect(response.body.document.workflow).toEqual({ startStepKey: '$completed', steps: [] });
    expect(response.body.document.form).toEqual({ titleFieldKey: '', sections: [] });
  });

  it('refuses to create a definition for a member with no process-owning role', async () => {
    const member = await buildMember(['member']);
    const app = buildApp();

    const response = await request(app)
      .post('/api/v1/process-definitions')
      .set('Cookie', member.cookie)
      .send(createBody());

    expect(response.status).toBe(403);
  });

  it('edits the open draft in place, without bumping the version number', async () => {
    const owner = await buildMember(['processOwner']);
    const app = buildApp();

    const created = await request(app)
      .post('/api/v1/process-definitions')
      .set('Cookie', owner.cookie)
      .send(createBody());
    const definitionId = created.body.definition.definitionId as string;

    const editBody = {
      name: 'Expense claim (edited)',
      form: {
        titleFieldKey: 'amount',
        sections: [
          {
            key: 'details',
            title: 'Details',
            fields: [{ key: 'amount', type: 'currency', label: 'Amount' }],
          },
        ],
      },
      workflow: { startStepKey: '$completed', steps: [] },
    };

    const firstEdit = await request(app)
      .patch(`/api/v1/process-definitions/${definitionId}/draft`)
      .set('Cookie', owner.cookie)
      .send(editBody);
    expect(firstEdit.status).toBe(200);
    expect(firstEdit.body.version.versionNumber).toBe(1);

    const secondEdit = await request(app)
      .patch(`/api/v1/process-definitions/${definitionId}/draft`)
      .set('Cookie', owner.cookie)
      .send({ ...editBody, name: 'Expense claim (edited again)' });
    expect(secondEdit.status).toBe(200);
    expect(secondEdit.body.version.versionId).toBe(firstEdit.body.version.versionId);
    expect(secondEdit.body.version.versionNumber).toBe(1);
    expect(secondEdit.body.document.name).toBe('Expense claim (edited again)');

    const loaded = await request(app)
      .get(`/api/v1/process-definitions/${definitionId}/draft`)
      .set('Cookie', owner.cookie);
    expect(loaded.status).toBe(200);
    expect(loaded.body.document.form.sections[0].fields[0].key).toBe('amount');
  });

  it('publishes the draft, then opens a new draft on the next edit without disturbing the published one', async () => {
    const owner = await buildMember(['processOwner']);
    const app = buildApp();

    const created = await request(app)
      .post('/api/v1/process-definitions')
      .set('Cookie', owner.cookie)
      .send(createBody());
    const definitionId = created.body.definition.definitionId as string;

    const publish = await request(app)
      .post(`/api/v1/process-definitions/${definitionId}/draft/publish`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(publish.status).toBe(200);
    expect(publish.body.version).toMatchObject({ versionNumber: 1, status: 'published' });

    const catalogueEntry = await request(app)
      .get(`/api/v1/process-definitions/${definitionId}`)
      .set('Cookie', owner.cookie);
    expect(catalogueEntry.status).toBe(200);
    expect(catalogueEntry.body.version.versionNumber).toBe(1);

    const edit = await request(app)
      .patch(`/api/v1/process-definitions/${definitionId}/draft`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Expense claim v2',
        form: { titleFieldKey: '', sections: [] },
        workflow: { startStepKey: '$completed', steps: [] },
      });
    expect(edit.status).toBe(200);
    expect(edit.body.version.versionNumber).toBe(2);

    // The published version must still read back unchanged: version pinning
    // (PRD.md §5.2/§11.2) means opening a new draft is never allowed to
    // touch what a case may already be pinned to.
    const stillPublished = await request(app)
      .get(`/api/v1/process-definitions/${definitionId}`)
      .set('Cookie', owner.cookie);
    expect(stillPublished.status).toBe(200);
    expect(stillPublished.body.version.versionNumber).toBe(1);
    expect(stillPublished.body.document.name).not.toBe('Expense claim v2');
  });

  it('returns 404, never 403, when another organisation reaches for the draft endpoints', async () => {
    const owner = await buildMember(['processOwner']);
    const outsider = await buildMember(['processOwner', 'admin']);
    const app = buildApp();

    const created = await request(app)
      .post('/api/v1/process-definitions')
      .set('Cookie', owner.cookie)
      .send(createBody());
    const definitionId = created.body.definition.definitionId as string;

    const getDraft = await request(app)
      .get(`/api/v1/process-definitions/${definitionId}/draft`)
      .set('Cookie', outsider.cookie);
    expect(getDraft.status).toBe(404);

    const patchDraft = await request(app)
      .patch(`/api/v1/process-definitions/${definitionId}/draft`)
      .set('Cookie', outsider.cookie)
      .send({
        name: 'Hijacked',
        form: { titleFieldKey: '', sections: [] },
        workflow: { startStepKey: '$completed', steps: [] },
      });
    expect(patchDraft.status).toBe(404);

    const publish = await request(app)
      .post(`/api/v1/process-definitions/${definitionId}/draft/publish`)
      .set('Cookie', outsider.cookie)
      .send({});
    expect(publish.status).toBe(404);
  });

  it("hides one process owner's draft from another process owner in the same organisation", async () => {
    const owner = await buildMember(['processOwner']);
    const colleague = await buildMember(['processOwner'], owner.organisationId);
    const app = buildApp();

    const created = await request(app)
      .post('/api/v1/process-definitions')
      .set('Cookie', owner.cookie)
      .send(createBody());
    const definitionId = created.body.definition.definitionId as string;

    const asColleague = await request(app)
      .get(`/api/v1/process-definitions/${definitionId}/draft`)
      .set('Cookie', colleague.cookie);
    expect(asColleague.status).toBe(404);

    const manageList = await request(app)
      .get('/api/v1/process-definitions/manage')
      .set('Cookie', colleague.cookie);
    expect(manageList.status).toBe(200);
    expect(
      manageList.body.data.some(
        (entry: { definitionId: string }) => entry.definitionId === definitionId,
      ),
    ).toBe(false);
  });

  // ADR-0027: a definition's owning group is the second way a process owner
  // may manage a definition they did not create, alongside creatorship.
  describe('group-scoped ownership (ADR-0027)', () => {
    it('lets a process owner who belongs to the owning group manage a colleague-created definition', async () => {
      const creator = await buildMember(['processOwner']);
      const groupMate = await buildMember(['processOwner'], creator.organisationId);
      const app = buildApp();

      const groupId = await withTenantTransaction(db, creator.organisationId, async (trx) => {
        const id = await ensureGroup(trx, {
          organisationId: creator.organisationId,
          key: `finance-${generateId()}`,
          name: 'Finance',
        });
        await ensureGroupMember(trx, {
          organisationId: creator.organisationId,
          groupId: id,
          userId: groupMate.userId,
        });
        return id;
      });

      const created = await request(app)
        .post('/api/v1/process-definitions')
        .set('Cookie', creator.cookie)
        .send(createBody({ owningGroupId: groupId }));
      expect(created.status).toBe(201);
      const definitionId = created.body.definition.definitionId as string;

      const draft = await request(app)
        .get(`/api/v1/process-definitions/${definitionId}/draft`)
        .set('Cookie', groupMate.cookie);
      expect(draft.status).toBe(200);

      const edit = await request(app)
        .patch(`/api/v1/process-definitions/${definitionId}/draft`)
        .set('Cookie', groupMate.cookie)
        .send({
          name: 'Edited by group mate',
          form: { titleFieldKey: '', sections: [] },
          workflow: { startStepKey: '$completed', steps: [] },
        });
      expect(edit.status).toBe(200);
      expect(edit.body.document.name).toBe('Edited by group mate');

      const manageList = await request(app)
        .get('/api/v1/process-definitions/manage')
        .set('Cookie', groupMate.cookie);
      expect(
        manageList.body.data.some(
          (entry: { definitionId: string }) => entry.definitionId === definitionId,
        ),
      ).toBe(true);
    });

    it('still refuses an unrelated process owner even when the definition has an owning group', async () => {
      const creator = await buildMember(['processOwner']);
      const outsider = await buildMember(['processOwner'], creator.organisationId);
      const app = buildApp();

      const groupId = await withTenantTransaction(db, creator.organisationId, (trx) =>
        ensureGroup(trx, {
          organisationId: creator.organisationId,
          key: `it-${generateId()}`,
          name: 'IT',
        }),
      );

      const created = await request(app)
        .post('/api/v1/process-definitions')
        .set('Cookie', creator.cookie)
        .send(createBody({ owningGroupId: groupId }));
      const definitionId = created.body.definition.definitionId as string;

      const draft = await request(app)
        .get(`/api/v1/process-definitions/${definitionId}/draft`)
        .set('Cookie', outsider.cookie);
      expect(draft.status).toBe(404);
    });

    it('leaves ADR-0015 creator-only behaviour unchanged when no owning group is set', async () => {
      const creator = await buildMember(['processOwner']);
      const colleague = await buildMember(['processOwner'], creator.organisationId);
      const app = buildApp();

      const created = await request(app)
        .post('/api/v1/process-definitions')
        .set('Cookie', creator.cookie)
        .send(createBody());
      expect(created.body.definition.owningGroupId).toBeNull();
      const definitionId = created.body.definition.definitionId as string;

      const draft = await request(app)
        .get(`/api/v1/process-definitions/${definitionId}/draft`)
        .set('Cookie', colleague.cookie);
      expect(draft.status).toBe(404);
    });
  });

  describe('pagination and search on the catalogue and manage list', () => {
    it('paginates the catalogue by name without repeating or skipping a definition', async () => {
      const owner = await buildMember(['processOwner']);
      const app = buildApp();
      const prefix = `catalogue-page-${generateId()}`;
      const names = ['A', 'B', 'C'].map((letter) => `${prefix}-${letter}`);

      for (const name of names) {
        const created = await request(app)
          .post('/api/v1/process-definitions')
          .set('Cookie', owner.cookie)
          .send(createBody({ name, referencePrefix: letterPrefix() }));
        await request(app)
          .post(`/api/v1/process-definitions/${created.body.definition.definitionId}/draft/publish`)
          .set('Cookie', owner.cookie)
          .send({});
      }

      const first = await request(app)
        .get('/api/v1/process-definitions')
        .query({ query: prefix, limit: 2 })
        .set('Cookie', owner.cookie);
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.hasMore).toBe(true);
      expect(first.body.data.map((d: { name: string }) => d.name)).toEqual([names[0], names[1]]);

      const second = await request(app)
        .get('/api/v1/process-definitions')
        .query({ query: prefix, limit: 2, cursor: first.body.nextCursor })
        .set('Cookie', owner.cookie);
      expect(second.status).toBe(200);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.hasMore).toBe(false);
      expect(second.body.data[0].name).toBe(names[2]);
    });

    it('filters the catalogue by a free-text name query', async () => {
      const owner = await buildMember(['processOwner']);
      const app = buildApp();
      const name = `findable-catalogue-${generateId()}`;

      const created = await request(app)
        .post('/api/v1/process-definitions')
        .set('Cookie', owner.cookie)
        .send(createBody({ name }));
      await request(app)
        .post(`/api/v1/process-definitions/${created.body.definition.definitionId}/draft/publish`)
        .set('Cookie', owner.cookie)
        .send({});

      const found = await request(app)
        .get('/api/v1/process-definitions')
        .query({ query: name })
        .set('Cookie', owner.cookie);
      expect(found.status).toBe(200);
      expect(found.body.data).toHaveLength(1);
      expect(found.body.data[0].name).toBe(name);
      expect(typeof found.body.data[0].createdAt).toBe('string');
    });

    it('paginates the manage list without repeating or skipping a definition the caller may manage', async () => {
      const owner = await buildMember(['processOwner']);
      const app = buildApp();
      const prefix = `manage-page-${generateId()}`;
      const names = ['A', 'B', 'C'].map((letter) => `${prefix}-${letter}`);

      for (const name of names) {
        await request(app)
          .post('/api/v1/process-definitions')
          .set('Cookie', owner.cookie)
          .send(createBody({ name, referencePrefix: letterPrefix() }));
      }

      const first = await request(app)
        .get('/api/v1/process-definitions/manage')
        .query({ query: prefix, limit: 2 })
        .set('Cookie', owner.cookie);
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.hasMore).toBe(true);

      const second = await request(app)
        .get('/api/v1/process-definitions/manage')
        .query({ query: prefix, limit: 2, cursor: first.body.nextCursor })
        .set('Cookie', owner.cookie);
      expect(second.status).toBe(200);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.hasMore).toBe(false);

      const seenNames = new Set([
        ...(first.body.data as Array<{ name: string }>).map((d) => d.name),
        ...(second.body.data as Array<{ name: string }>).map((d) => d.name),
      ]);
      expect(seenNames).toEqual(new Set(names));
    });

    it('never lets pagination surface a definition the caller may not manage', async () => {
      // The permission filter runs before pagination is applied (route-level,
      // not SQL), so this proves paging through a mixed set of "mine" and
      // "somebody else's" definitions never leaks the latter onto a page.
      const owner = await buildMember(['processOwner']);
      const colleague = await buildMember(['processOwner'], owner.organisationId);
      const app = buildApp();
      const prefix = `manage-mixed-${generateId()}`;

      for (let i = 0; i < 3; i += 1) {
        await request(app)
          .post('/api/v1/process-definitions')
          .set('Cookie', owner.cookie)
          .send(
            createBody({
              name: `${prefix}-owner-${i}`,
              referencePrefix: letterPrefix(),
            }),
          );
      }
      await request(app)
        .post('/api/v1/process-definitions')
        .set('Cookie', colleague.cookie)
        .send(
          createBody({
            name: `${prefix}-colleague`,
            referencePrefix: letterPrefix(),
          }),
        );

      const collected: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const response = await request(app)
          .get('/api/v1/process-definitions/manage')
          .query({ query: prefix, limit: 2, ...(cursor ? { cursor } : {}) })
          .set('Cookie', owner.cookie);
        expect(response.status).toBe(200);
        collected.push(...(response.body.data as Array<{ name: string }>).map((d) => d.name));
        if (!response.body.hasMore) {
          break;
        }
        cursor = response.body.nextCursor as string;
      }

      expect(collected).toHaveLength(3);
      expect(collected.every((name) => name.includes('-owner-'))).toBe(true);
    });
  });
});
