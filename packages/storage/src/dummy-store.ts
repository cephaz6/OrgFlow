import type {
  FileStore,
  HeadObjectResult,
  PresignedUpload,
  PresignUploadInput,
} from './file-store.js';

interface StoredObject {
  bytes: Buffer;
  sizeBytes: number;
}

export interface DummyFileStore extends FileStore {
  // In-memory objects, keyed by storage key. A test seeds this directly
  // to simulate "the client already uploaded to S3" without a real
  // network round trip.
  objects: Map<string, StoredObject>;
  clear(): void;
}

// The local-dev default and the unit-test default, not test-only, per
// CLAUDE.md's "dummy, never fake" naming rule (packages/email's
// dummy-sender.ts is the same shape).
export function createDummyFileStore(): DummyFileStore {
  const objects = new Map<string, StoredObject>();

  return {
    objects,
    clear() {
      objects.clear();
    },
    async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
      return {
        url: `https://dummy-file-store.invalid/${encodeURIComponent(input.key)}`,
        fields: {
          key: input.key,
          'Content-Type': input.contentType,
        },
      };
    },
    async presignDownload(key: string): Promise<string> {
      return `https://dummy-file-store.invalid/${encodeURIComponent(key)}`;
    },
    async headObject(key: string): Promise<HeadObjectResult> {
      const object = objects.get(key);
      return object
        ? { exists: true, sizeBytes: object.sizeBytes }
        : { exists: false, sizeBytes: null };
    },
    async getObjectBytes(key: string, maxBytes: number): Promise<Buffer> {
      const object = objects.get(key);
      if (!object) {
        throw new Error(`No such object: ${key}`);
      }
      return object.bytes.subarray(0, maxBytes);
    },
    async moveToQuarantine(key: string): Promise<string> {
      const object = objects.get(key);
      if (!object) {
        throw new Error(`No such object: ${key}`);
      }
      const quarantineKey = `quarantine/${key}`;
      objects.set(quarantineKey, object);
      objects.delete(key);
      return quarantineKey;
    },
    async deleteObject(key: string): Promise<void> {
      objects.delete(key);
    },
  };
}
