import {
  createProcessDefinition,
  createProcessVersion,
  createUserWithIdentity,
  ensureGroup,
  ensureGroupMember,
  findOrganisationMemberByUserId,
  findProcessDefinitionByKey,
  findUserByIdentity,
  insertOrganisationMember,
  publishProcessVersion,
  setLineManager,
  withTenantTransaction,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import {
  buildLaptopRequestDefinition,
  insertProcessDefinitionDocument,
  IT_SUPPORT_GROUP_KEY,
  LAPTOP_REQUEST_KEY,
  LAPTOP_REQUEST_REFERENCE_PREFIX,
} from '@orgflow/documents';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';

// The Laptop Request seed needs packages/db and packages/documents in the
// same operation, and the dependency direction (CLAUDE.md §3) allows only
// an application to combine them. That is why registration lives here
// rather than in packages/documents, which builds the document but cannot
// write the process_definitions and process_versions rows that point at it.

const MANAGER_ISSUER = 'urn:orgflow:dev';
const MANAGER_SUBJECT = 'dev-manager';

export interface SeedLaptopRequestInput {
  organisationId: string;
  ownerUserId: string;
}

export interface SeededLaptopRequest {
  definitionId: string;
  versionId: string;
  itSupportGroupId: string;
  lineManagerUserId: string;
}

// Idempotent: safe to call on every dev-login, which is exactly how it is
// invoked. A second call finds the published definition and returns it
// untouched rather than creating a second version, because publishing a
// version makes its document immutable (PRD.md §8.1) and a duplicate would
// leave two versions of an identical process competing to be current.
export async function ensureLaptopRequestSeeded(
  db: Kysely<Database>,
  mongoClient: MongoClient,
  input: SeedLaptopRequestInput,
): Promise<SeededLaptopRequest> {
  const lineManagerUserId = await ensureLineManager(db, input);

  return withTenantTransaction(db, input.organisationId, async (trx) => {
    const itSupportGroupId = await ensureGroup(trx, {
      organisationId: input.organisationId,
      key: IT_SUPPORT_GROUP_KEY,
      name: 'IT Support',
      description: 'Fulfils equipment requests.',
    });

    // The requester is also the fulfiller locally, so the IT fulfilment
    // step has somebody able to claim it.
    await ensureGroupMember(trx, {
      organisationId: input.organisationId,
      groupId: itSupportGroupId,
      userId: input.ownerUserId,
    });

    const existing = await findProcessDefinitionByKey(trx, LAPTOP_REQUEST_KEY);
    if (existing?.currentVersionId) {
      return {
        definitionId: existing.definitionId,
        versionId: existing.currentVersionId,
        itSupportGroupId,
        lineManagerUserId,
      };
    }

    const definition =
      existing ??
      (await createProcessDefinition(trx, {
        organisationId: input.organisationId,
        key: LAPTOP_REQUEST_KEY,
        name: 'Laptop request',
        description: 'Request a new or replacement laptop',
        category: 'IT',
        icon: 'laptop',
        referencePrefix: LAPTOP_REQUEST_REFERENCE_PREFIX,
        retentionDays: 2555,
        createdByUserId: input.ownerUserId,
      }));

    const document = buildLaptopRequestDefinition({
      organisationId: input.organisationId,
      definitionId: definition.definitionId,
      createdByUserId: input.ownerUserId,
      createdAt: new Date().toISOString(),
    });

    // Written to Mongo inside the Postgres transaction. If the transaction
    // then rolls back, the document survives as an unreferenced orphan
    // rather than corruption: definition documents are immutable and
    // reached only by the _id a process_versions row holds, so a document
    // no row points at is invisible. The reverse order would be worse,
    // leaving a version row pointing at a document that does not exist.
    const stored = await insertProcessDefinitionDocument(mongoClient, document);

    const version = await createProcessVersion(trx, {
      organisationId: input.organisationId,
      definitionId: definition.definitionId,
      versionNumber: 1,
      documentId: stored.documentId,
      documentHash: stored.documentHash,
      changeNote: 'Seeded from PRD.md §4.',
      publishedByUserId: input.ownerUserId,
    });

    await publishProcessVersion(trx, version.versionId, input.ownerUserId);

    return {
      definitionId: definition.definitionId,
      versionId: version.versionId,
      itSupportGroupId,
      lineManagerUserId,
    };
  });
}

// The Laptop Request starts on a `lineManager` step, so without a line
// manager on record every submission would resolve to nobody and land in
// `unassigned`. Correct engine behaviour, but it would make the local
// journey untestable, so the seed provides a manager to approve.
async function ensureLineManager(
  db: Kysely<Database>,
  input: SeedLaptopRequestInput,
): Promise<string> {
  const existing = await findUserByIdentity(db, MANAGER_ISSUER, MANAGER_SUBJECT);
  const manager =
    existing?.user ??
    (await createUserWithIdentity(db, {
      email: 'manager@orgflow.local',
      displayName: 'Local Dev Manager',
      issuer: MANAGER_ISSUER,
      subject: MANAGER_SUBJECT,
    }));

  await withTenantTransaction(db, input.organisationId, async (trx) => {
    const membership = await findOrganisationMemberByUserId(trx, manager.userId);
    if (!membership) {
      await insertOrganisationMember(trx, {
        organisationId: input.organisationId,
        userId: manager.userId,
        roles: ['member', 'approver'],
      });
    }

    const owner = await findOrganisationMemberByUserId(trx, input.ownerUserId);
    if (owner && !owner.lineManagerUserId) {
      await setLineManager(trx, input.ownerUserId, manager.userId);
    }
  });

  return manager.userId;
}

// Exported so tests can assert against the same identity the seed creates
// rather than restating the literal.
export const DEV_LINE_MANAGER_IDENTITY = {
  issuer: MANAGER_ISSUER,
  subject: MANAGER_SUBJECT,
} as const;
