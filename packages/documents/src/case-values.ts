import type { Uuid } from '@orgflow/types';
import type { MongoClient } from 'mongodb';

import { caseValuesCollection } from './collections.js';
import type { CaseValuesDocument } from './types.js';

// As in process-definitions.ts: organisationId is a required argument on
// every function and always reaches the filter, so a caller cannot
// accidentally read or write another tenant's values (CLAUDE.md §3).

export interface UpsertCaseValuesInput {
  organisationId: Uuid;
  caseId: Uuid;
  values: Record<string, unknown>;
  now: string;
}

// Upsert rather than insert: a draft's values are saved repeatedly as the
// requester edits, and the unique index on (organisationId, caseId) means
// there is exactly one values document per case either way.
export async function upsertCaseValues(
  client: MongoClient,
  input: UpsertCaseValuesInput,
): Promise<string> {
  const result = await caseValuesCollection(client).findOneAndUpdate(
    { organisationId: input.organisationId, caseId: input.caseId },
    {
      $set: { values: input.values, updatedAt: input.now },
      $setOnInsert: {
        organisationId: input.organisationId,
        caseId: input.caseId,
        createdAt: input.now,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  if (!result) {
    throw new Error(`Failed to upsert case values for case ${input.caseId}.`);
  }

  return result._id.toString();
}

export async function findCaseValues(
  client: MongoClient,
  organisationId: Uuid,
  caseId: Uuid,
): Promise<CaseValuesDocument | null> {
  return caseValuesCollection(client).findOne({ organisationId, caseId });
}

// Returns the submitted values, or an empty object when a case has none
// yet. The engine treats an absent field as null (PRD.md §5.3), so an
// empty object is a valid input rather than an error state.
export async function readCaseValues(
  client: MongoClient,
  organisationId: Uuid,
  caseId: Uuid,
): Promise<Record<string, unknown>> {
  const document = await findCaseValues(client, organisationId, caseId);
  return document?.values ?? {};
}
