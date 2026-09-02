import type { TemplateBlueprint, Uuid } from '@orgflow/types';
import type { MongoClient } from 'mongodb';

import { templatesCollection } from './collections.js';
import type { StoredTemplateDocument } from './types.js';

// PRD.md §9, ADR-0042. Unlike every other module in this package, tenant
// scoping here cannot be a required organisationId on every function,
// because a system template belongs to no tenant. So the two cases are two
// functions with different names, and neither can be reached by accident:
// there is no single call that reads "a template" without the caller having
// said which kind it meant.

export interface InsertTemplateDocumentInput {
  organisationId: Uuid;
  templateId: Uuid;
  blueprint: TemplateBlueprint;
  now: string;
}

export async function insertTemplateDocument(
  client: MongoClient,
  input: InsertTemplateDocumentInput,
): Promise<string> {
  const result = await templatesCollection(client).insertOne({
    organisationId: input.organisationId,
    templateId: input.templateId,
    blueprint: input.blueprint,
    createdAt: input.now,
  });

  return result.insertedId.toString();
}

// Seeding only. Kept separate from the tenant-owned insert above so that
// writing a null organisationId is something a caller has to ask for by
// name, rather than something that happens when a variable is undefined.
export async function insertSystemTemplateDocument(
  client: MongoClient,
  input: { templateId: Uuid; blueprint: TemplateBlueprint; now: string },
): Promise<string> {
  const result = await templatesCollection(client).insertOne({
    organisationId: null,
    templateId: input.templateId,
    blueprint: input.blueprint,
    createdAt: input.now,
  });

  return result.insertedId.toString();
}

// The organisationId is in the filter as well as the templateId, so a
// tenant asking for a template by an id it guessed cannot read another
// tenant's blueprint even though the id is unique on its own.
export async function findTemplateDocument(
  client: MongoClient,
  organisationId: Uuid,
  templateId: Uuid,
): Promise<StoredTemplateDocument | null> {
  return templatesCollection(client).findOne({ organisationId, templateId });
}

// A published template is readable by any organisation (the Postgres
// policy in the templates migration decides that), so this deliberately
// does not filter by organisationId. The caller must already have
// established, against the registry, that the template is published:
// this function trusts that and reads the blueprint it names.
export async function findSharedTemplateDocument(
  client: MongoClient,
  templateId: Uuid,
): Promise<StoredTemplateDocument | null> {
  return templatesCollection(client).findOne({ templateId });
}

export async function updateTemplateDocument(
  client: MongoClient,
  organisationId: Uuid,
  templateId: Uuid,
  blueprint: TemplateBlueprint,
): Promise<boolean> {
  const result = await templatesCollection(client).updateOne(
    { organisationId, templateId },
    { $set: { blueprint } },
  );

  return result.matchedCount > 0;
}

export async function deleteTemplateDocument(
  client: MongoClient,
  organisationId: Uuid,
  templateId: Uuid,
): Promise<boolean> {
  const result = await templatesCollection(client).deleteOne({ organisationId, templateId });
  return result.deletedCount > 0;
}
