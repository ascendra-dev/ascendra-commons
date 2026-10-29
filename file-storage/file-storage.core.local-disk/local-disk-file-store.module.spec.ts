import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LocalDiskFileStoreModule } from './local-disk-file-store.module';
import { LocalDiskFileStore } from './local-disk-file-store';
import { contentDisposition } from './local-disk-blob.controller';
import { LOCAL_DISK_FILE_STORE } from './tokens';
import { FILE_STORE_CONFIG } from '../file-storage.core';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'local-disk-mod-'));
});
afterAll(() => rm(root, { recursive: true, force: true }));

const config = () => ({
  rootDir: root,
  publicBaseUrl: 'http://localhost:3010/local-files',
  signingSecret: 's'.repeat(32),
  fileStoreConfig: { buildObjectKey: ({ filename }: { filename: string }) => `k/${filename}` },
});

async function body(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

describe('LocalDiskFileStoreModule.forRoot', () => {
  it('refuses a relative root, a missing URL or a short secret', () => {
    expect(() => LocalDiskFileStoreModule.forRoot({ ...config(), rootDir: 'rel' })).toThrow(/absolute rootDir/);
    expect(() => LocalDiskFileStoreModule.forRoot({ ...config(), publicBaseUrl: '/local-files' })).toThrow(/publicBaseUrl/);
    expect(() => LocalDiskFileStoreModule.forRoot({ ...config(), signingSecret: 'short' })).toThrow(/32 characters/);
  });

  it('boots, binds the store and serves a signed URL through its controller (with the app decorator applied)', async () => {
    const mod = LocalDiskFileStoreModule.forRoot({ ...config(), routeDecorators: [SetMetadata('isPublic', true)] });
    const ref = await Test.createTestingModule({ imports: [mod] }).compile();
    const store = ref.get<LocalDiskFileStore>(LOCAL_DISK_FILE_STORE);
    expect(store).toBeInstanceOf(LocalDiskFileStore);
    expect(ref.get(FILE_STORE_CONFIG)).toBeDefined();

    const Ctrl = mod.controllers![0];
    expect(Reflect.getMetadata('isPublic', Ctrl)).toBe(true);
    expect(Reflect.getMetadata('path', Ctrl)).toBe('local-files');
    const controller = ref.get(Ctrl) as { serve(t: string): Promise<{ getStream(): Readable; getHeaders(): Record<string, unknown> }> };

    const pdf = await store.upload(Buffer.from('%PDF-1.4'), { contentType: 'application/pdf', filename: 'r.pdf', category: 'c', tenantId: 't', bucket: 'b' });
    const pdfFile = await controller.serve((await store.getUrl(pdf.fileRef, { filename: 'r.pdf', contentType: 'application/pdf' })).split('/').pop()!);
    expect(pdfFile.getHeaders()).toMatchObject({ type: 'application/pdf', length: 8, disposition: expect.stringMatching(/^inline; filename="r.pdf"/) });
    expect(await body(pdfFile.getStream())).toBe('%PDF-1.4');

    const html = await store.upload(Buffer.from('<script>'), { contentType: 'text/html', filename: 'x.html', category: 'c', tenantId: 't', bucket: 'b' });
    const htmlFile = await controller.serve((await store.getUrl(html.fileRef, { filename: 'x.html', contentType: 'text/html' })).split('/').pop()!);
    expect(htmlFile.getHeaders()).toMatchObject({ type: 'application/octet-stream', disposition: expect.stringMatching(/^attachment;/) });
    htmlFile.getStream().destroy();

    await expect(controller.serve('forged.token')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('contentDisposition keeps a UTF-8 name and an ASCII fallback without quotes', () => {
    expect(contentDisposition('attachment', 'résumé "v2".pdf')).toBe(
      `attachment; filename="r_sum_ _v2_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`,
    );
    expect(contentDisposition('inline', undefined)).toBe('inline');
  });
});
