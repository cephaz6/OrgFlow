import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api-client';
import type { AttachmentResponse, CaseCommentEntry, CaseEnvelope, CaseResponse } from './types';

// Browser-side mutations, called from the form runtime and the case
// actions. Nothing here may import api-server.ts.

// A draft with no answers yet, created the moment a "new request" form is
// opened rather than at final submit. A case has to exist before a file
// field on it can accept an upload (POST /attachments/presign-upload
// requires a caseId), so file uploads on a brand-new request are only
// possible if the draft already exists while the form is being filled in.
export async function createDraftCase(definitionId: string): Promise<CaseResponse> {
  const created = await apiPost<CaseEnvelope>('/cases', { definitionId, values: {} });
  return created.case;
}

export async function patchCaseValues(
  caseId: string,
  values: Record<string, unknown>,
): Promise<CaseResponse> {
  const response = await apiPatch<CaseEnvelope>(`/cases/${caseId}`, { values });
  return response.case;
}

export async function submitCase(caseId: string): Promise<CaseResponse> {
  const response = await apiPost<CaseEnvelope>(`/cases/${caseId}/submit`);
  return response.case;
}

export async function cancelCase(caseId: string, reason: string): Promise<CaseResponse> {
  const response = await apiPost<CaseEnvelope>(`/cases/${caseId}/cancel`, { reason });
  return response.case;
}

export async function postCaseComment(
  caseId: string,
  input: { body: string; visibility: 'all' | 'approvers' },
): Promise<CaseCommentEntry> {
  return apiPost<CaseCommentEntry>(`/cases/${caseId}/comments`, input);
}

export async function resubmitCase(
  caseId: string,
  values: Record<string, unknown>,
): Promise<CaseResponse> {
  const response = await apiPost<CaseEnvelope>(`/cases/${caseId}/resubmit`, { values });
  return response.case;
}

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
}

export interface PresignAttachmentUploadInput {
  caseId: string;
  fieldKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PresignAttachmentUploadResult {
  attachment: AttachmentResponse;
  upload: PresignedUpload;
}

export async function presignAttachmentUpload(
  input: PresignAttachmentUploadInput,
): Promise<PresignAttachmentUploadResult> {
  return apiPost<PresignAttachmentUploadResult>('/attachments/presign-upload', input);
}

export async function confirmAttachmentUpload(attachmentId: string): Promise<AttachmentResponse> {
  const response = await apiPost<{ attachment: AttachmentResponse }>(
    `/attachments/${attachmentId}/confirm`,
  );
  return response.attachment;
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  return apiDelete(`/attachments/${attachmentId}`);
}

export interface AttachmentDownload {
  downloadUrl: string;
  filename: string;
}

export async function getAttachmentDownloadUrl(attachmentId: string): Promise<AttachmentDownload> {
  return apiGet<AttachmentDownload>(`/attachments/${attachmentId}/download`);
}

// Direct to the store (S3, or the dummy store's fabricated URL locally),
// bypassing our own API entirely: that is the whole point of a presigned
// POST, the file's bytes never pass through our server.
export async function uploadToPresignedUrl(upload: PresignedUpload, file: File): Promise<void> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) {
    formData.append(key, value);
  }
  // S3's presigned-POST contract requires the file field last; anything
  // appended after it is ignored.
  formData.append('file', file);

  const response = await fetch(upload.url, { method: 'POST', body: formData });
  if (!response.ok) {
    throw new Error('The file could not be uploaded. Try again.');
  }
}
