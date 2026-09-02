import type { Collection, Db, MongoClient } from 'mongodb';

import type {
  CaseValuesDocument,
  StoredProcessDefinitionDocument,
  StoredTemplateDocument,
} from './types.js';

// PRD.md §12: Mongo collections are camelCase and plural.
export const COLLECTIONS = {
  processDefinitions: 'processDefinitions',
  caseValues: 'caseValues',
  templates: 'templates',
} as const;

export function processDefinitionsCollection(
  client: MongoClient,
): Collection<StoredProcessDefinitionDocument> {
  return client.db().collection<StoredProcessDefinitionDocument>(COLLECTIONS.processDefinitions);
}

export function caseValuesCollection(client: MongoClient): Collection<CaseValuesDocument> {
  return client.db().collection<CaseValuesDocument>(COLLECTIONS.caseValues);
}

export function templatesCollection(client: MongoClient): Collection<StoredTemplateDocument> {
  return client.db().collection<StoredTemplateDocument>(COLLECTIONS.templates);
}

// PRD.md §5.2: organisationId is on every document and indexed. Every
// index here leads with it, so a tenant-scoped query never degrades into a
// collection scan that reads other tenants' documents on the way past.
//
// Idempotent: createIndex is a no-op when the index already exists, so
// this is safe to call on every boot.
export async function ensureIndexes(client: MongoClient): Promise<void> {
  const db: Db = client.db();

  await db.collection(COLLECTIONS.processDefinitions).createIndexes([
    {
      key: { organisationId: 1, definitionId: 1, versionNumber: -1 },
      name: 'org_definition_version',
    },
    { key: { organisationId: 1, key: 1 }, name: 'org_key' },
  ]);

  await db
    .collection(COLLECTIONS.caseValues)
    .createIndexes([{ key: { organisationId: 1, caseId: 1 }, name: 'org_case', unique: true }]);

  // templateId is unique on its own rather than paired with organisationId,
  // because a system template's organisationId is null (ADR-0042) and would
  // make a compound unique index treat every system document as the same
  // key. The registry row already guarantees the id, so uniqueness on it is
  // the honest constraint; the org-leading index is what keeps a tenant's
  // own lookups from scanning past other tenants' documents.
  await db.collection(COLLECTIONS.templates).createIndexes([
    { key: { templateId: 1 }, name: 'template_id', unique: true },
    { key: { organisationId: 1, templateId: 1 }, name: 'org_template' },
  ]);
}
