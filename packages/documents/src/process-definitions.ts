import type { ProcessDefinitionDocument, Uuid } from '@orgflow/types';
import { ObjectId, type MongoClient, type WithId } from 'mongodb';

import { processDefinitionsCollection } from './collections.js';
import { hashDocument } from './document-hash.js';
import type { StoredProcessDefinitionDocument } from './types.js';

export interface StoredDefinition {
  documentId: string;
  documentHash: string;
  document: StoredProcessDefinitionDocument;
}

// What a read returns: the stored document with its Mongo _id rendered as
// a string. Everything outside this package deals in string ids, and
// crucially this shape satisfies ProcessDefinitionDocument, so a document
// read from Mongo can be handed straight to the engine without a cast.
export type ReadProcessDefinitionDocument = StoredProcessDefinitionDocument & { _id: string };

function toReadDocument(
  document: WithId<StoredProcessDefinitionDocument>,
): ReadProcessDefinitionDocument {
  const { _id, ...rest } = document;
  return { ...rest, _id: _id.toString() };
}

// CLAUDE.md §3: every Mongo query is scoped by organisationId, and the
// scoping lives here rather than in a caller that could forget it. Every
// exported function therefore takes organisationId as a required argument
// and puts it in the filter; none accepts a raw filter from outside.

export async function insertProcessDefinitionDocument(
  client: MongoClient,
  document: ProcessDefinitionDocument,
): Promise<StoredDefinition> {
  const { _id: _ignored, ...withoutId } = document;
  const documentHash = hashDocument(withoutId);
  const stored: StoredProcessDefinitionDocument = { ...withoutId, documentHash };

  const result = await processDefinitionsCollection(client).insertOne(stored);

  return { documentId: result.insertedId.toString(), documentHash, document: stored };
}

export async function findProcessDefinitionDocumentById(
  client: MongoClient,
  organisationId: Uuid,
  documentId: string,
): Promise<ReadProcessDefinitionDocument | null> {
  if (!ObjectId.isValid(documentId)) {
    // A malformed id is a miss, not a crash: it reaches us from a
    // process_versions row or a URL, and neither is worth throwing over.
    return null;
  }

  const document = await processDefinitionsCollection(client).findOne({
    _id: new ObjectId(documentId),
    organisationId,
  });

  return document ? toReadDocument(document) : null;
}

export async function findLatestProcessDefinitionDocument(
  client: MongoClient,
  organisationId: Uuid,
  definitionId: Uuid,
): Promise<ReadProcessDefinitionDocument | null> {
  const document = await processDefinitionsCollection(client).findOne(
    { organisationId, definitionId },
    { sort: { versionNumber: -1 } },
  );

  return document ? toReadDocument(document) : null;
}

// PRD.md §5.2: published version documents are immutable. A change creates
// a new document, never an update, and the function below is the one
// deliberate exception. It exists for the builder's own draft, which no
// case can ever be pinned to (a case's version_id only ever points at a
// version that has been through publishProcessVersion, and this function
// exists precisely to be called before that happens); an in-place edit
// there rewrites nothing a case depends on. It is the caller's
// responsibility, enforced at the API route, to invoke this only while the
// owning process_versions row is still status = 'draft'; nothing here
// re-checks that, the same division PATCH /cases/:id relies on for
// draft-only case edits.
export async function updateProcessDefinitionDocument(
  client: MongoClient,
  organisationId: Uuid,
  documentId: string,
  document: ProcessDefinitionDocument,
): Promise<StoredDefinition> {
  // Same shape as insertProcessDefinitionDocument: _id is Mongo's concern,
  // never the caller's, and documentHash is computed here, never trusted
  // from outside.
  const { _id: _ignored, ...withoutId } = document;
  const documentHash = hashDocument(withoutId);
  const stored: StoredProcessDefinitionDocument = { ...withoutId, documentHash };

  await processDefinitionsCollection(client).replaceOne(
    { _id: new ObjectId(documentId), organisationId },
    stored,
  );

  return { documentId, documentHash, document: stored };
}

// Verifies a document still hashes to what process_versions recorded when
// it was published. PRD.md §2.2 calls document_hash an integrity check, and
// a check nothing ever performs is not one.
export function verifyDocumentIntegrity(
  document: ReadProcessDefinitionDocument | StoredProcessDefinitionDocument,
  expectedHash: string,
): boolean {
  // Both the stored hash and the _id Mongo assigned are excluded, since
  // neither existed when the original hash was computed.
  const { documentHash: _stored, ...rest } = document;
  const { _id: _ignored, ...withoutId } = rest as Record<string, unknown>;
  return hashDocument(withoutId) === expectedHash;
}
