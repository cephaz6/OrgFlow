import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createS3FileStore } from './s3-store.js';

// Proves the real S3 round trip (presigned POST, HeadObject, byte range
// reads, quarantine copy+delete) against real LocalStack S3, rather than
// asserting against a stub, the same reasoning
// packages/events/src/events.integration.test.ts publishes to a real SNS
// topic instead of mocking the SDK.
const REGION = 'eu-west-2';
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test' };
const BUCKET = 'orgflow-test-attachments';

describe('the S3 file store against LocalStack', () => {
  let ENDPOINT: string;
  let s3: S3Client;

  beforeAll(async () => {
    ENDPOINT = process.env.ORGFLOW_TEST_AWS_ENDPOINT!;
    s3 = new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      credentials: CREDENTIALS,
      forcePathStyle: true,
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }, 60_000);

  afterAll(async () => {
    s3.destroy();
  });

  function store() {
    return createS3FileStore({ bucket: BUCKET, region: REGION, endpoint: ENDPOINT });
  }

  it('presigns an upload whose fields actually work against S3', async () => {
    const fileStore = store();
    const key = 'org-1/cases/case-1/att-1/quote.pdf';
    const contentType = 'application/pdf';
    const body = Buffer.from('%PDF-1.4 fake pdf body');

    const { url, fields } = await fileStore.presignUpload({
      key,
      contentType,
      maxSizeBytes: 1_000_000,
    });

    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      form.append(name, value);
    }
    form.append('file', new Blob([body], { type: contentType }));

    const response = await fetch(url, { method: 'POST', body: form });
    expect(response.ok).toBe(true);

    const head = await fileStore.headObject(key);
    expect(head).toEqual({ exists: true, sizeBytes: body.length });
  });

  it('reports a missing object as not existing', async () => {
    const fileStore = store();
    const head = await fileStore.headObject('org-1/cases/case-1/att-missing/nope.pdf');
    expect(head).toEqual({ exists: false, sizeBytes: null });
  });

  it('reads object bytes for content sniffing without requiring the whole file', async () => {
    const fileStore = store();
    const key = 'org-1/cases/case-1/att-2/sniff-me.bin';
    const contentType = 'application/octet-stream';
    // The first four bytes are the well-known PDF magic number; a real
    // sniffer would key off exactly this.
    const body = Buffer.from([0x25, 0x50, 0x44, 0x46, ...Array(1000).fill(0x00)]);

    const { url, fields } = await fileStore.presignUpload({
      key,
      contentType,
      maxSizeBytes: 1_000_000,
    });
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      form.append(name, value);
    }
    form.append('file', new Blob([body], { type: contentType }));
    await fetch(url, { method: 'POST', body: form });

    const sniffed = await fileStore.getObjectBytes(key, 4);
    expect(Array.from(sniffed)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('moves an object to a quarantine prefix, leaving the original key gone', async () => {
    const fileStore = store();
    const key = 'org-1/cases/case-1/att-3/eicar.txt';
    const contentType = 'text/plain';
    const body = Buffer.from(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    );

    const { url, fields } = await fileStore.presignUpload({
      key,
      contentType,
      maxSizeBytes: 1_000_000,
    });
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      form.append(name, value);
    }
    form.append('file', new Blob([body], { type: contentType }));
    await fetch(url, { method: 'POST', body: form });

    const quarantineKey = await fileStore.moveToQuarantine(key);

    expect(quarantineKey).toBe(`quarantine/${key}`);
    expect(await fileStore.headObject(key)).toEqual({ exists: false, sizeBytes: null });
    expect(await fileStore.headObject(quarantineKey)).toEqual({
      exists: true,
      sizeBytes: body.length,
    });
  });

  it('generates a working presigned download URL', async () => {
    const fileStore = store();
    const key = 'org-1/cases/case-1/att-4/download-me.txt';
    const contentType = 'text/plain';
    const body = Buffer.from('hello download');

    const { url, fields } = await fileStore.presignUpload({
      key,
      contentType,
      maxSizeBytes: 1_000_000,
    });
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      form.append(name, value);
    }
    form.append('file', new Blob([body], { type: contentType }));
    await fetch(url, { method: 'POST', body: form });

    const downloadUrl = await fileStore.presignDownload(key, 900);
    const response = await fetch(downloadUrl);

    expect(response.ok).toBe(true);
    expect(await response.text()).toBe('hello download');
  });

  it('deletes an object outright', async () => {
    const fileStore = store();
    const key = 'org-1/cases/case-1/att-5/delete-me.txt';
    const contentType = 'text/plain';
    const body = Buffer.from('gone soon');

    const { url, fields } = await fileStore.presignUpload({
      key,
      contentType,
      maxSizeBytes: 1_000_000,
    });
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      form.append(name, value);
    }
    form.append('file', new Blob([body], { type: contentType }));
    await fetch(url, { method: 'POST', body: form });

    await fileStore.deleteObject(key);

    expect(await fileStore.headObject(key)).toEqual({ exists: false, sizeBytes: null });
  });
});
