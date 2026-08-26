import { describe, expect, it } from 'vitest';

import { createDummyFileStore } from './dummy-store.js';

describe('the dummy file store', () => {
  it('reports an object as missing until one is seeded', async () => {
    const store = createDummyFileStore();

    expect(await store.headObject('a/b/c.pdf')).toEqual({ exists: false, sizeBytes: null });

    store.objects.set('a/b/c.pdf', { bytes: Buffer.from('hello'), sizeBytes: 5 });

    expect(await store.headObject('a/b/c.pdf')).toEqual({ exists: true, sizeBytes: 5 });
  });

  it('returns at most maxBytes from getObjectBytes', async () => {
    const store = createDummyFileStore();
    store.objects.set('big.bin', { bytes: Buffer.from('0123456789'), sizeBytes: 10 });

    const bytes = await store.getObjectBytes('big.bin', 4);

    expect(bytes.toString()).toBe('0123');
  });

  it('throws reading an object that was never seeded', async () => {
    const store = createDummyFileStore();
    await expect(store.getObjectBytes('missing.bin', 10)).rejects.toThrow('No such object');
  });

  it('moves an object to a quarantine-prefixed key, removing the original', async () => {
    const store = createDummyFileStore();
    store.objects.set('case/attachment/eicar.txt', { bytes: Buffer.from('X5O!'), sizeBytes: 4 });

    const quarantineKey = await store.moveToQuarantine('case/attachment/eicar.txt');

    expect(quarantineKey).toBe('quarantine/case/attachment/eicar.txt');
    expect(await store.headObject('case/attachment/eicar.txt')).toEqual({
      exists: false,
      sizeBytes: null,
    });
    expect(await store.headObject(quarantineKey)).toEqual({ exists: true, sizeBytes: 4 });
  });

  it('deletes an object outright', async () => {
    const store = createDummyFileStore();
    store.objects.set('to-delete.bin', { bytes: Buffer.from('x'), sizeBytes: 1 });

    await store.deleteObject('to-delete.bin');

    expect(await store.headObject('to-delete.bin')).toEqual({ exists: false, sizeBytes: null });
  });

  it('clear() empties every seeded object', async () => {
    const store = createDummyFileStore();
    store.objects.set('one.bin', { bytes: Buffer.from('1'), sizeBytes: 1 });
    store.objects.set('two.bin', { bytes: Buffer.from('2'), sizeBytes: 1 });

    store.clear();

    expect(store.objects.size).toBe(0);
  });

  it('presignUpload and presignDownload return usable-looking URLs without touching real infra', async () => {
    const store = createDummyFileStore();

    const upload = await store.presignUpload({
      key: 'org/cases/case-1/att-1/file.pdf',
      contentType: 'application/pdf',
      maxSizeBytes: 1024,
    });
    expect(upload.url).toContain('file.pdf');
    expect(upload.fields['Content-Type']).toBe('application/pdf');

    const downloadUrl = await store.presignDownload('org/cases/case-1/att-1/file.pdf', 900);
    expect(downloadUrl).toContain('file.pdf');
  });
});
