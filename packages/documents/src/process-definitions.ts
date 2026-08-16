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
// a new document, never an update. There is deliberately no update or
// delete function in this module to match; version pinning (§11.2) depends
// on a document staying exactly as it was when a case was submitted
// against it, and an in-place edit would silently rewrite history for every
// in-flight case.

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
