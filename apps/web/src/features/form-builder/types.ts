import type { ProcessDefinitionDocument } from '@orgflow/types';

// The management projection GET /process-definitions/manage and the write
// endpoints return (apps/api/src/routes/process-definitions.ts's
// toManagementEntry), wider than the catalogue's toCatalogueEntry because a
// process owner managing their own definitions needs createdAt/updatedAt.
export interface ManagedDefinition {
  definitionId: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  status: string;
  currentVersionId: string | null;
  // ADR-0027: null means no owning group, unchanged from before this
  // existed.
  owningGroupId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftVersionSummary {
  versionId: string;
  versionNumber: number;
  status: string;
  publishedAt?: string | null;
}

export interface DraftDetail {
  definition: ManagedDefinition;
  version: DraftVersionSummary;
  document: ProcessDefinitionDocument;
}

// The body PATCH /process-definitions/:id/draft accepts: the document minus
// every server-controlled field (organisationId, definitionId,
// versionNumber, createdByUserId, createdAt), matching
// apps/api/src/processes/document-schema.ts's definitionDocumentBodySchema.
export type DraftDocumentBody = Pick<
  ProcessDefinitionDocument,
  | 'name'
  | 'description'
  | 'category'
  | 'icon'
  | 'form'
  | 'workflow'
  | 'notifications'
  | 'retentionDays'
>;

export interface CreateDefinitionBody {
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  referencePrefix: string;
  retentionDays?: number;
  owningGroupId?: string | null;
}
