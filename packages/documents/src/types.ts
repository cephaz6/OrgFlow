import type { IsoDateTimeString, ProcessDefinitionDocument, Uuid } from '@orgflow/types';

// The definition document as it sits in Mongo. ProcessDefinitionDocument
// already carries organisationId and definitionId; this adds only what
// storage itself needs.
//
// `_id` is omitted deliberately. The shared type declares it as an optional
// string for consumers that only ever see it serialised, but Mongo's own
// type for it is ObjectId, and leaving both in scope makes every filter
// involving _id fail to typecheck. Omitting it lets the driver's WithId<>
// supply the real ObjectId on reads.
export type StoredProcessDefinitionDocument = Omit<ProcessDefinitionDocument, '_id'> & {
  // SHA-256 of the canonical serialisation, mirrored into
  // process_versions.document_hash so the relational registry can detect a
  // document that has been altered underneath it (PRD.md §2.2).
  documentHash: string;
};

// PRD.md §2.3: cases.values_document_id points at one of these. Kept in
// Mongo rather than Postgres because the shape is whatever the definition's
// form declares, which changes with every field a process owner adds.
export interface CaseValuesDocument {
  organisationId: Uuid;
  caseId: Uuid;
  // Keyed by the form field key. Values are whatever the field type
  // produces, so this is deliberately not narrowed further.
  values: Record<string, unknown>;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
