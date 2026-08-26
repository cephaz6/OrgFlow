// ADR-0008's 3-part service pattern (interface + dummy + real), the same
// shape as packages/email: a genuinely swappable transport behind an
// interface, not an abstraction built for a hypothetical second provider.

export interface PresignedUpload {
  url: string;
  // The form fields a browser must include alongside the file in a
  // multipart POST, matching S3's presigned-POST contract exactly
  // (includes the policy document and signature; the caller never
  // constructs these itself).
  fields: Record<string, string>;
}

export interface PresignUploadInput {
  key: string;
  contentType: string;
  maxSizeBytes: number;
}

export interface HeadObjectResult {
  exists: boolean;
  sizeBytes: number | null;
}

export interface FileStore {
  presignUpload(input: PresignUploadInput): Promise<PresignedUpload>;
  // Expiry is always short-lived and generated per request (PRD.md §16.2:
  // 15 minutes, never cached), so the interface takes it explicitly rather
  // than defaulting it silently.
  presignDownload(key: string, expiresInSeconds: number): Promise<string>;
  headObject(key: string): Promise<HeadObjectResult>;
  // For server-side content sniffing: reads at most maxBytes from the
  // start of the object, enough for magic-byte detection without pulling
  // an entire multi-MB file into memory.
  getObjectBytes(key: string, maxBytes: number): Promise<Buffer>;
  // Copies to a quarantine-prefixed key and deletes the original,
  // returning the new key. Never called on anything the pipeline still
  // needs to serve: once an object is moved, the original key is gone.
  moveToQuarantine(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
