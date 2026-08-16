import { advance } from '@orgflow/core';
import type { EvaluationContext } from '@orgflow/types';
import type { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readCaseValues, upsertCaseValues } from './case-values.js';
import { ensureIndexes, processDefinitionsCollection } from './collections.js';
import { createMongoClient } from './connection.js';
import { hashDocument } from './document-hash.js';
import {
  findLatestProcessDefinitionDocument,
  findProcessDefinitionDocumentById,
  insertProcessDefinitionDocument,
  verifyDocumentIntegrity,
} from './process-definitions.js';
import { buildLaptopRequestDefinition, IT_SUPPORT_GROUP_KEY } from './seed/laptop-request.js';

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const DEFINITION_ID = '00000000-0000-0000-0000-0000000000ee';
const USER_ID = '00000000-0000-0000-0000-000000000001';
const LINE_MANAGER = '00000000-0000-0000-0000-000000000002';
const IT_GROUP_ID = '00000000-0000-0000-0000-0000000000aa';

function seedDefinition(organisationId: string) {
  return buildLaptopRequestDefinition({
    organisationId,
    definitionId: DEFINITION_ID,
    createdByUserId: USER_ID,
    createdAt: '2026-08-01T00:00:00.000Z',
  });
}

describe('definition and values documents', () => {
  let client: MongoClient;

  beforeAll(async () => {
    client = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
    await ensureIndexes(client);
  });

  afterAll(async () => {
    await client.close();
  });

  it('creates its indexes idempotently', async () => {
    // Called once in beforeAll; calling it again must not throw, since it
    // runs on every boot.
    await ensureIndexes(client);

    const indexes = await processDefinitionsCollection(client).indexes();
    expect(indexes.map((index) => index.name)).toContain('org_definition_version');
  });

  it('stores and retrieves a definition document, scoped to its tenant', async () => {
    const stored = await insertProcessDefinitionDocument(client, seedDefinition(ORG_A));

    const foundByA = await findProcessDefinitionDocumentById(client, ORG_A, stored.documentId);
    expect(foundByA?.key).toBe('laptop-request');

    // The same document id, asked for by a different tenant, is a miss.
    const foundByB = await findProcessDefinitionDocumentById(client, ORG_B, stored.documentId);
    expect(foundByB).toBeNull();
  });

  it('treats a malformed document id as a miss rather than throwing', async () => {
    expect(await findProcessDefinitionDocumentById(client, ORG_A, 'not-an-object-id')).toBeNull();
  });

  it('finds the latest version for a definition within a tenant', async () => {
    const organisationId = '00000000-0000-0000-0000-00000000000c';
    const base = seedDefinition(organisationId);

    await insertProcessDefinitionDocument(client, base);
    await insertProcessDefinitionDocument(client, { ...base, versionNumber: 2 });
    await insertProcessDefinitionDocument(client, { ...base, versionNumber: 3 });

    const latest = await findLatestProcessDefinitionDocument(client, organisationId, DEFINITION_ID);
    expect(latest?.versionNumber).toBe(3);
  });

  it('hashes a document by content, not by key order', () => {
    const document = seedDefinition(ORG_A);

    // Rebuild the same object with its keys inserted in reverse order.
    // JSON.stringify would serialise these differently, so an unsorted
    // hash would differ; the point of canonicalising is that it does not.
    const reordered = Object.fromEntries(Object.entries(document).reverse()) as typeof document;

    expect(Object.keys(reordered)).not.toEqual(Object.keys(document));
    expect(hashDocument(reordered)).toBe(hashDocument(document));
  });

  it('produces a different hash when content actually changes', () => {
    const document = seedDefinition(ORG_A);
    const altered = { ...document, name: 'Laptop request (amended)' };

    expect(hashDocument(altered)).not.toBe(hashDocument(document));
  });

  it('detects a document that has been altered underneath its registry row', async () => {
    const stored = await insertProcessDefinitionDocument(client, seedDefinition(ORG_A));
    const document = await findProcessDefinitionDocumentById(client, ORG_A, stored.documentId);

    expect(verifyDocumentIntegrity(document!, stored.documentHash)).toBe(true);

    // Simulate tampering: the document no longer matches the hash the
    // relational registry recorded at publish time.
    const tampered = { ...document!, name: 'Something else entirely' };
    expect(verifyDocumentIntegrity(tampered, stored.documentHash)).toBe(false);
  });

  it('keeps case values isolated per tenant and returns an empty object when absent', async () => {
    const caseId = '00000000-0000-0000-0000-0000000000d1';

    await upsertCaseValues(client, {
      organisationId: ORG_A,
      caseId,
      values: { laptopModel: 'mbp14', estimatedCost: 900 },
      now: '2026-08-14T12:00:00.000Z',
    });

    expect(await readCaseValues(client, ORG_A, caseId)).toEqual({
      laptopModel: 'mbp14',
      estimatedCost: 900,
    });

    // Another tenant asking for the same case id sees nothing, and gets an
    // empty object rather than an error, because the engine treats a
    // missing field as null.
    expect(await readCaseValues(client, ORG_B, caseId)).toEqual({});
  });

  it('overwrites values on repeated saves rather than accumulating documents', async () => {
    const caseId = '00000000-0000-0000-0000-0000000000d2';

    const firstId = await upsertCaseValues(client, {
      organisationId: ORG_A,
      caseId,
      values: { estimatedCost: 500 },
      now: '2026-08-14T12:00:00.000Z',
    });
    const secondId = await upsertCaseValues(client, {
      organisationId: ORG_A,
      caseId,
      values: { estimatedCost: 1500 },
      now: '2026-08-14T13:00:00.000Z',
    });

    // The unique index means one values document per case, so the id is
    // stable across saves.
    expect(secondId).toBe(firstId);
    expect(await readCaseValues(client, ORG_A, caseId)).toEqual({ estimatedCost: 1500 });
  });
});

// The point of Phase 1: the engine running against the real §4 document
// read back out of Mongo, rather than a transcription of it in a test file.
describe('the engine against the stored Laptop Request definition', () => {
  let client: MongoClient;

  function context(): EvaluationContext {
    return {
      now: '2026-08-14T12:00:00.000Z',
      correlationId: 'integration-test',
      submitter: {
        userId: USER_ID,
        department: 'Engineering',
        roles: ['member'],
        lineManagerUserId: LINE_MANAGER,
      },
      case: { daysOpen: 0 },
      step: { escalationLevel: 0 },
      directory: { groupIdsByKey: { [IT_SUPPORT_GROUP_KEY]: IT_GROUP_ID } },
    };
  }

  const caseState = {
    caseId: '00000000-0000-0000-0000-0000000000dd',
    definitionId: DEFINITION_ID,
    versionId: '00000000-0000-0000-0000-0000000000cc',
    status: 'draft' as const,
    outcome: null,
    currentStepKey: null,
  };

  beforeAll(async () => {
    client = await createMongoClient({ uri: process.env.ORGFLOW_TEST_MONGODB_URI! });
  });

  afterAll(async () => {
    await client.close();
  });

  it('runs the cheap path to completion: manager then IT, finance skipped', async () => {
    const organisationId = '00000000-0000-0000-0000-00000000001a';
    const stored = await insertProcessDefinitionDocument(client, seedDefinition(organisationId));
    const definition = (await findProcessDefinitionDocumentById(
      client,
      organisationId,
      stored.documentId,
    ))!;

    const values = { laptopModel: 'mbp14', estimatedCost: 900, justification: 'Mine broke.' };

    const submitted = advance({
      definition,
      caseState,
      values,
      event: { type: 'caseSubmitted' },
      context: context(),
    });
    expect(submitted.errors).toEqual([]);
    expect(submitted.caseUpdates.currentStepKey).toBe('managerApproval');
    expect(submitted.tasksToCreate[0]?.assigneeUserId).toBe(LINE_MANAGER);

    const afterManager = advance({
      definition,
      caseState: { ...caseState, status: 'active', currentStepKey: 'managerApproval' },
      values,
      event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      context: context(),
    });
    expect(afterManager.caseUpdates.currentStepKey).toBe('itFulfilment');
    expect(afterManager.tasksToCreate[0]?.assigneeGroupId).toBe(IT_GROUP_ID);

    const afterIt = advance({
      definition,
      caseState: { ...caseState, status: 'active', currentStepKey: 'itFulfilment' },
      values,
      event: { type: 'taskDecided', taskId: 'task-2', decision: 'complete' },
      context: context(),
    });
    expect(afterIt.caseUpdates.status).toBe('completed');
    expect(afterIt.caseUpdates.outcome).toBe('approved');
  });

  it('inserts the finance step above the threshold, using a role the role model actually has', async () => {
    const organisationId = '00000000-0000-0000-0000-00000000001b';
    const stored = await insertProcessDefinitionDocument(client, seedDefinition(organisationId));
    const definition = (await findProcessDefinitionDocumentById(
      client,
      organisationId,
      stored.documentId,
    ))!;

    const afterManager = advance({
      definition,
      caseState: { ...caseState, status: 'active', currentStepKey: 'managerApproval' },
      values: { laptopModel: 'mbp16', estimatedCost: 2400 },
      event: { type: 'taskDecided', taskId: 'task-1', decision: 'approve' },
      context: context(),
    });

    expect(afterManager.errors).toEqual([]);
    expect(afterManager.caseUpdates.currentStepKey).toBe('financeApproval');
    // 'approver' is a real OrganisationRole; PRD.md §4's illustrative
    // 'financeApprover' is not, and would resolve to nobody.
    expect(afterManager.tasksToCreate[0]?.assigneeRole).toBe('approver');
  });
});
