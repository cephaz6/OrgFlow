import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  FileStore,
  HeadObjectResult,
  PresignedUpload,
  PresignUploadInput,
} from './file-store.js';

export interface S3FileStoreConfig {
  bucket: string;
  region: string;
  // Set to the LocalStack container's endpoint for local development and
  // integration tests; left undefined in a deployed environment so the SDK
  // resolves the real service endpoint itself (matching
  // sns-publisher.ts's SnsPublisherConfig).
  endpoint?: string | undefined;
}

// The bytes actually read off a stream body; getObjectBytes's caller
// decides how many, this just drains what the SDK hands back up to that
// point.
async function readBytes(body: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    total += buffer.length;
    if (total >= maxBytes) {
      break;
    }
  }

  return Buffer.concat(chunks).subarray(0, maxBytes);
}

export function createS3FileStore(config: S3FileStoreConfig): FileStore {
  const clientConfig: S3ClientConfig = { region: config.region };
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    // LocalStack accepts any credentials, but the SDK refuses to sign a
    // request without some, and a developer machine will not always have
    // real ones configured.
    clientConfig.credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
    // A path-style URL (endpoint/bucket/key) rather than virtual-hosted
    // (bucket.endpoint/key): LocalStack does not resolve bucket-subdomain
    // DNS the way real S3 does.
    clientConfig.forcePathStyle = true;
  }

  const client = new S3Client(clientConfig);

  return {
    async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
      const { url, fields } = await createPresignedPost(client, {
        Bucket: config.bucket,
        Key: input.key,
        Conditions: [
          ['content-length-range', 0, input.maxSizeBytes],
          ['eq', '$Content-Type', input.contentType],
        ],
        Fields: {
          'Content-Type': input.contentType,
        },
        Expires: 900,
      });

      return { url, fields };
    },

    async presignDownload(key: string, expiresInSeconds: number): Promise<string> {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },

    async headObject(key: string): Promise<HeadObjectResult> {
      try {
        const response = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return { exists: true, sizeBytes: response.ContentLength ?? null };
      } catch (err) {
        if (err instanceof NotFound) {
          return { exists: false, sizeBytes: null };
        }
        throw err;
      }
    },

    async getObjectBytes(key: string, maxBytes: number): Promise<Buffer> {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key, Range: `bytes=0-${maxBytes - 1}` }),
      );
      const body = response.Body as NodeJS.ReadableStream;
      return readBytes(body, maxBytes);
    },

    async moveToQuarantine(key: string): Promise<string> {
      const quarantineKey = `quarantine/${key}`;
      await client.send(
        new CopyObjectCommand({
          Bucket: config.bucket,
          Key: quarantineKey,
          // CopySource is a single opaque path, not Bucket/Key fields, so
          // the key half must be percent-encoded itself (AWS's own
          // documented requirement) even though slashes inside it stay
          // literal.
          CopySource: `${config.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
        }),
      );
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      return quarantineKey;
    },

    async deleteObject(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}
