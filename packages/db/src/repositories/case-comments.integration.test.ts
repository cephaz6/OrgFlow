import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from '../connection.js';
import { createCaseComment, findCommentsForCase } from './case-comments.js';
import { createCase } from './cases.js';
import {
  createProcessDefinition,
  createProcessVersion,
  publishProcessVersion,
} from './process-definitions.js';
import { createOrganisation } from './organisations.js';
import { createUserWithIdentity } from './users.js';
import type { Database } from '../schema.js';
import { withTenantTransaction } from '../tenant-transaction.js';
import { generateId } from '../uuid.js';

describe('case comments, tenant-scoped and visibility-filtered', () => {
  let db: Kysely<Database>;
  let organisationId: string;
  let otherOrganisationId: string;
  let userId: string;
  let caseId: string;
  let otherCaseId: string;

  async function seedCase(orgId: string, uid: string) {
    return withTenantTransaction(db, orgId, async (trx) => {
      const definition = await createProcessDefinition(trx, {
        organisationId: orgId,
        key: `comments-test-${generateId()}`,
        name: 'Comments test process',
        referencePrefix: 'CMT',
        createdByUserId: uid,
      });
      const version = await createProcessVersion(trx, {
        organisationId: orgId,
        definitionId: definition.definitionId,
        versionNumber: 1,
        documentId: `doc-${generateId()}`,
        documentHash: 'sha256-placeholder',
      });
      await publishProcessVersion(trx, version.versionId, uid);

      return createCase(trx, {
        organisationId: orgId,
        definitionId: definition.definitionId,
        versionId: version.versionId,
        title: 'A comments test case',
        submittedByUserId: uid,
      });
    });
  }

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });

    const user = await createUserWithIdentity(db, {
      email: `comments-${generateId()}@example.invalid`,
      displayName: 'Comments test user',
      issuer: 'urn:orgflow:test',
      subject: `comments-${generateId()}`,
    });
    userId = user.userId;

    const organisation = await createOrganisation(db, {
      name: 'Comments test tenant',
      slug: `comments-${generateId()}`,
      createdByUserId: userId,
    });
    organisationId = organisation.organisationId;

    const otherOrganisation = await createOrganisation(db, {
      name: 'Comments other tenant',
      slug: `comments-other-${generateId()}`,
      createdByUserId: userId,
    });
    otherOrganisationId = otherOrganisation.organisationId;

    const created = await seedCase(organisationId, userId);
    caseId = created.caseId;

    const otherCreated = await seedCase(otherOrganisationId, userId);
    otherCaseId = otherCreated.caseId;
  });

  afterAll(async () => {
    await db
      .deleteFrom('organisations')
      .where('organisation_id', 'in', [organisationId, otherOrganisationId])
      .execute();
    await db.deleteFrom('users').where('user_id', '=', userId).execute();
    await db.destroy();
  });

  it('excludes approvers-only comments unless explicitly included', async () => {
    await withTenantTransaction(db, organisationId, async (trx) => {
      await createCaseComment(trx, {
        organisationId,
        caseId,
        authorUserId: userId,
        body: 'Visible to the requester too.',
        visibility: 'all',
      });
      await createCaseComment(trx, {
        organisationId,
        caseId,
        authorUserId: userId,
        body: 'Internal note.',
        visibility: 'approvers',
      });
    });

    const publicOnly = await withTenantTransaction(db, organisationId, (trx) =>
      findCommentsForCase(trx, caseId, { includeApproversOnly: false }),
    );
    expect(publicOnly.map((c) => c.body)).toEqual(['Visible to the requester too.']);

    const everything = await withTenantTransaction(db, organisationId, (trx) =>
      findCommentsForCase(trx, caseId, { includeApproversOnly: true }),
    );
    expect(everything.map((c) => c.body)).toEqual([
      'Visible to the requester too.',
      'Internal note.',
    ]);
  });

  it("never returns another tenant's comments for a case in this tenant", async () => {
    await withTenantTransaction(db, otherOrganisationId, (trx) =>
      createCaseComment(trx, {
        organisationId: otherOrganisationId,
        caseId: otherCaseId,
        authorUserId: userId,
        body: 'A comment in the other tenant.',
        visibility: 'all',
      }),
    );

    // Scoped to organisationId's own RLS context, queried by the other
    // tenant's caseId: RLS hides the row entirely, rather than this
    // tenant's context somehow reaching across into it.
    const crossTenantView = await withTenantTransaction(db, organisationId, (trx) =>
      findCommentsForCase(trx, otherCaseId, { includeApproversOnly: true }),
    );
    expect(crossTenantView).toEqual([]);
  });
});
