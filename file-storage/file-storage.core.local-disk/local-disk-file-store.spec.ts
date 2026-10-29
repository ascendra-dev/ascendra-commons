import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStoreError } from '../file-storage.core';
import { LocalDiskFileStore } from './local-disk-file-store';

let root: string;
let key = 'obj';
const meta = { contentType: 'application/pdf', filename: 'a.pdf', category: 'kyc', tenantId: 't1', bucket: 'kyc' };
const make = () =>
  new LocalDiskFileStore(
    { rootDir: root, publicBaseUrl: 'http://localhost:3010/local-files/', signingSecret: 's'.repeat(32) },
    { buildObjectKey: () => key },
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'local-disk-'));
  key = 't1/kyc/obj-1';
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('LocalDiskFileStore', () => {
  it('writes under rootDir/bucket/key and returns "{bucket}/{key}"', async () => {
    const store = make();
    const { fileRef } = await store.upload(Buffer.from('%PDF'), meta);
    expect(fileRef).toBe('kyc/t1/kyc/obj-1');
    expect(await readFile(join(root, 'kyc', 't1', 'kyc', 'obj-1'), 'utf8')).toBe('%PDF');
  });

  it('never overwrites an existing object', async () => {
    const store = make();
    await store.upload(Buffer.from('one'), meta);
    await expect(store.upload(Buffer.from('two'), meta)).rejects.toBeInstanceOf(FileStoreError);
  });

  it('refuses a key or bucket that climbs out of its bucket', async () => {
    const store = make();
    key = '../../escape';
    await expect(store.upload(Buffer.from('x'), meta)).rejects.toBeInstanceOf(FileStoreError);
    await expect(store.upload(Buffer.from('x'), { ...meta, bucket: '..' })).rejects.toBeInstanceOf(FileStoreError);
    expect(() => store.pathOf('kyc/../other/x')).toThrow(FileStoreError);
    expect(() => store.pathOf('nokey')).toThrow(FileStoreError);
  });

  it('signs a URL under publicBaseUrl that open() turns back into the object', async () => {
    const store = make();
    const { fileRef } = await store.upload(Buffer.from('%PDF'), meta);
    const url = await store.getUrl(fileRef, { expirySeconds: 60, filename: 'a.pdf', contentType: 'application/pdf' });
    expect(url.startsWith('http://localhost:3010/local-files/')).toBe(true);
    expect(url).not.toContain('//local-files//');
    const opened = await store.open(url.split('/').pop()!);
    expect(opened).toMatchObject({ size: 4, filename: 'a.pdf', contentType: 'application/pdf' });
  });

  it('open() is null for a forged token or a deleted object', async () => {
    const store = make();
    const { fileRef } = await store.upload(Buffer.from('%PDF'), meta);
    const token = (await store.getUrl(fileRef)).split('/').pop()!;
    expect(await store.open(`${token}x`)).toBeNull();
    await store.delete(fileRef);
    expect(await store.open(token)).toBeNull();
  });

  it('deleting a missing object is not an error', async () => {
    await expect(make().delete('kyc/never/there')).resolves.toBeUndefined();
  });
});

describe('LocalDiskFileStore.listObjects', () => {
  it('lists a bucket by fileRef, paging after the cursor', async () => {
    const store = make();
    for (const k of ['t1/b', 't1/a', 't2/c']) {
      key = k;
      await store.upload(Buffer.from(k), meta);
    }
    const first = await store.listObjects('kyc', { limit: 2 });
    expect(first.objects.map((o) => o.fileRef)).toEqual(['kyc/t1/a', 'kyc/t1/b']);
    expect(first.objects[0]).toMatchObject({ sizeBytes: 4, modifiedAt: expect.any(Date) });
    const second = await store.listObjects('kyc', { limit: 2, cursor: first.nextCursor! });
    expect(second).toEqual({ objects: [expect.objectContaining({ fileRef: 'kyc/t2/c' })], nextCursor: null });
  });

  it('an empty or missing bucket lists nothing; a bad bucket name is refused', async () => {
    expect(await make().listObjects('nothing-here', { limit: 10 })).toEqual({ objects: [], nextCursor: null });
    await expect(make().listObjects('../x', { limit: 10 })).rejects.toBeInstanceOf(FileStoreError);
  });
});
