import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3FileStore } from './s3-file-store';
import { S3FileStoreModule } from './s3-file-store.module';
import { S3_FILE_STORE } from './tokens';
import { FileStoreError } from '../file-storage.core';

const config = { buildObjectKey: ({ tenantId, category }: { tenantId: string | null; category: string }) => `${tenantId}/${category}/obj` };
const meta = { contentType: 'application/pdf', filename: 'a.pdf', category: 'kyc', tenantId: 't1', bucket: 'files' };
/** A real client with fake credentials — presigning is local, and `send` is spied, so nothing leaves the process. */
const client = () => new S3Client({ region: 'eu-west-1', credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' } });

describe('S3FileStore', () => {
  it('uploads with the content type, If-None-Match and SSE, and returns "{bucket}/{key}"', async () => {
    const c = client();
    const send = vi.spyOn(c, 'send').mockResolvedValue({} as never);
    const store = new S3FileStore(c, config, { serverSideEncryption: 'aws:kms', kmsKeyId: 'key-1' });
    expect(await store.upload(Buffer.from('%PDF'), meta)).toEqual({ fileRef: 'files/t1/kyc/obj' });
    const cmd = send.mock.calls[0][0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toMatchObject({ Bucket: 'files', Key: 't1/kyc/obj', ContentType: 'application/pdf', IfNoneMatch: '*', ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'key-1' });
  });

  it('presigns a GET that serves a PDF inline and anything else as an attachment, with the filename', async () => {
    const store = new S3FileStore(client(), config, {});
    const pdf = new URL(await store.getUrl('files/t1/kyc/obj', { expirySeconds: 60, filename: 'r.pdf', contentType: 'application/pdf' }));
    expect(pdf.hostname).toBe('files.s3.eu-west-1.amazonaws.com');
    expect(pdf.pathname).toBe('/t1/kyc/obj');
    expect(pdf.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(pdf.searchParams.get('response-content-type')).toBe('application/pdf');
    expect(pdf.searchParams.get('response-content-disposition')).toMatch(/^inline; filename="r.pdf"/);
    const html = new URL(await store.getUrl('files/x', { filename: 'x.html', contentType: 'text/html' }));
    expect(html.searchParams.get('response-content-type')).toBe('application/octet-stream');
    expect(html.searchParams.get('response-content-disposition')).toMatch(/^attachment;/);
  });

  it('deletes by bucket and key; refuses a ref with no key', async () => {
    const c = client();
    const send = vi.spyOn(c, 'send').mockResolvedValue({} as never);
    const store = new S3FileStore(c, config, {});
    await store.delete('files/t1/kyc/obj');
    expect((send.mock.calls[0][0] as DeleteObjectCommand).input).toEqual({ Bucket: 'files', Key: 't1/kyc/obj' });
    await expect(store.delete('nokey')).rejects.toBeInstanceOf(FileStoreError);
  });

  it('lists a bucket, paging after the cursor', async () => {
    const c = client();
    const send = vi.spyOn(c, 'send').mockResolvedValue({
      Contents: [{ Key: 't1/a', Size: 3, LastModified: new Date('2026-10-01') }],
      IsTruncated: true,
    } as never);
    const page = await new S3FileStore(c, config, {}).listObjects('files', { limit: 1, cursor: 'files/t0/z' });
    expect((send.mock.calls[0][0] as ListObjectsV2Command).input).toEqual({ Bucket: 'files', MaxKeys: 1, StartAfter: 't0/z' });
    expect(page).toEqual({ objects: [{ fileRef: 'files/t1/a', sizeBytes: 3, modifiedAt: new Date('2026-10-01') }], nextCursor: 'files/t1/a' });
  });

  it('wraps a provider error in FileStoreError', async () => {
    const c = client();
    vi.spyOn(c, 'send').mockRejectedValue(Object.assign(new Error('At least one of the pre-conditions failed'), { name: 'PreconditionFailed' }));
    await expect(new S3FileStore(c, config, {}).upload(Buffer.from('x'), meta)).rejects.toThrow(/s3 upload failed: PreconditionFailed/);
  });
});

describe('S3FileStoreModule.forRoot', () => {
  const CLIENT = Symbol('CLIENT');
  @Module({ providers: [{ provide: CLIENT, useValue: client() }], exports: [CLIENT] })
  class ClientModule {}

  it('binds the store over the app client', async () => {
    const ref = await Test.createTestingModule({
      imports: [S3FileStoreModule.forRoot({ s3ClientToken: CLIENT, fileStoreConfig: config, imports: [ClientModule] })],
    }).compile();
    expect(ref.get(S3_FILE_STORE)).toBeInstanceOf(S3FileStore);
  });

  it('refuses a KMS key without aws:kms', () => {
    expect(() => S3FileStoreModule.forRoot({ s3ClientToken: CLIENT, fileStoreConfig: config, kmsKeyId: 'k' })).toThrow(/aws:kms/);
  });
});
