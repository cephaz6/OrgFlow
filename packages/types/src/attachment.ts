import type { IsoDateTimeString, Uuid } from './common.js';

export type AttachmentScanStatus = 'pending' | 'clean' | 'infected' | 'error';

// PRD.md §16: an attachment is a case-scoped upload against one `file`
// field. Postgres is the sole source of truth for its storage location and
// scan status; a case's Mongo values document only ever holds the
// attachment id as a thin reference.
export interface Attachment {
  attachmentId: Uuid;
  organisationId: Uuid;
  caseId: Uuid;
  fieldKey: string;
  filename: string;
  declaredMimeType: string;
  sniffedMimeType: string | null;
  sizeBytes: number;
  storageKey: string;
  scanStatus: AttachmentScanStatus;
  uploadedByUserId: Uuid;
  confirmedAt: IsoDateTimeString | null;
  scannedAt: IsoDateTimeString | null;
  deletedAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
