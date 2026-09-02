import { apiPatch, apiPost } from '../../lib/api-client';
import type {
  CreateDefinitionBody,
  DraftDetail,
  DraftDocumentBody,
  ManagedDefinition,
} from './types';

interface CreateDefinitionResponse {
  definition: ManagedDefinition;
  version: { versionId: string; versionNumber: number; status: string };
  document: DraftDetail['document'];
}

export async function createDefinition(
  body: CreateDefinitionBody,
): Promise<CreateDefinitionResponse> {
  return apiPost<CreateDefinitionResponse>('/process-definitions', body);
}

interface SaveDraftResponse {
  version: { versionId: string; versionNumber: number; status: string };
  document: DraftDetail['document'];
}

export async function saveDraft(
  definitionId: string,
  body: DraftDocumentBody,
): Promise<SaveDraftResponse> {
  return apiPatch<SaveDraftResponse>(
    `/process-definitions/${encodeURIComponent(definitionId)}/draft`,
    body,
  );
}

interface PublishDraftResponse {
  version: {
    versionId: string;
    versionNumber: number;
    status: string;
    publishedAt: string | null;
  };
}

export async function publishDraft(
  definitionId: string,
  changeNote?: string,
): Promise<PublishDraftResponse> {
  return apiPost<PublishDraftResponse>(
    `/process-definitions/${encodeURIComponent(definitionId)}/draft/publish`,
    changeNote ? { changeNote } : {},
  );
}

export interface SaveAsTemplateBody {
  definitionId: string;
  name: string;
  description: string | null;
  category: string | null;
}

export async function saveAsTemplate(body: SaveAsTemplateBody): Promise<{
  template: { templateId: string; name: string };
}> {
  return apiPost('/templates', body);
}
