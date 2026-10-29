import { link, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { dirname, relative, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import {
  FILE_STORE_CONFIG,
  FileStoreError,
  type DirectUploadFileStore,
  type FileStoreConfig,
  type ListableFileStore,
  type StoredObject,
} from '../file-storage.core';
import { LocalDiskSigner } from './local-disk-signer';
import { LOCAL_DISK_OPTIONS } from './tokens';

export interface LocalDiskOptions {
  /** Absolute directory the buckets live under — one sub-directory per bucket. */
  rootDir: string;
  /** Where `LocalDiskBlobController` is reachable, e.g. `http://localhost:3010/local-files` — a URL is `${publicBaseUrl}/${token}`. */
  publicBaseUrl: string;
  /** HMAC secret for download tokens — at least 32 characters. */
  signingSecret: string;
}

/** A bucket is one path segment — no traversal, no hidden directory. */
const BUCKET = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

/**
 * A `FileStore` on the local filesystem — for development, tests and a
 * single-node deployment. Same contract as the Supabase store: `fileRef` is
 * `"{bucket}/{objectKey}"`; `getUrl` hands out a short-lived signed URL, served
 * by `LocalDiskBlobController` (the token is the whole grant).
 *
 * Every path is resolved and checked to stay under `rootDir` — an object key
 * built from user input can't climb out (`../`), and a bucket is one segment.
 */
@Injectable()
export class LocalDiskFileStore implements ListableFileStore, DirectUploadFileStore {
  private readonly root: string;
  private readonly signer: LocalDiskSigner;

  constructor(
    @Inject(LOCAL_DISK_OPTIONS) private readonly options: LocalDiskOptions,
    @Inject(FILE_STORE_CONFIG) private readonly config: FileStoreConfig,
  ) {
    this.root = resolve(options.rootDir);
    this.signer = new LocalDiskSigner(options.signingSecret);
  }

  async upload(
    file: Buffer,
    meta: { contentType: string; filename: string; category: string; tenantId: string | null; bucket: string },
  ): Promise<{ fileRef: string }> {
    const objectKey = this.config.buildObjectKey({ tenantId: meta.tenantId, category: meta.category, filename: meta.filename });
    const fileRef = `${meta.bucket}/${objectKey}`;
    const path = this.pathOf(fileRef);
    try {
      await mkdir(dirname(path), { recursive: true });
      // `wx`: never overwrite — two uploads resolving to one key is a bug in buildObjectKey, not a replace.
      await writeFile(path, file, { flag: 'wx' });
    } catch (e) {
      throw new FileStoreError(`local-disk upload failed: ${(e as Error).message}`);
    }
    return { fileRef };
  }

  async getUrl(
    fileRef: string,
    opts?: { expirySeconds?: number; filename?: string | null; contentType?: string },
  ): Promise<string> {
    this.pathOf(fileRef); // refuse a ref that could never have been stored here
    const token = this.signer.sign({
      fileRef,
      expiresAt: Math.floor(Date.now() / 1000) + (opts?.expirySeconds ?? 300),
      filename: opts?.filename ?? undefined,
      contentType: opts?.contentType,
    });
    return this.urlFor(token);
  }

  reserveRef(meta: { tenantId: string; category: string; filename: string; bucket: string }): string {
    const fileRef = `${meta.bucket}/${this.config.buildObjectKey(meta)}`;
    this.pathOf(fileRef);
    return fileRef;
  }

  /**
   * A `PUT` URL served by `LocalDiskBlobController`. The client sends
   * `Content-Type: application/octet-stream` whatever the file is — the app's
   * JSON / form body parsers then leave the stream alone; the record keeps the
   * real type.
   */
  async createUploadUrl(
    fileRef: string,
    opts: { contentType: string; sizeBytes: number; expirySeconds: number },
  ): Promise<{ url: string; method: 'PUT'; headers: Record<string, string> }> {
    this.pathOf(fileRef);
    const token = this.signer.sign({
      fileRef,
      expiresAt: Math.floor(Date.now() / 1000) + opts.expirySeconds,
      op: 'put',
      maxBytes: opts.sizeBytes,
    });
    return { url: this.urlFor(token), method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' } };
  }

  async stat(fileRef: string): Promise<{ sizeBytes: number } | null> {
    const info = await stat(this.pathOf(fileRef)).catch(() => null);
    return info?.isFile() ? { sizeBytes: info.size } : null;
  }

  async read(fileRef: string): Promise<Buffer> {
    try {
      return await readFile(this.pathOf(fileRef));
    } catch (e) {
      throw new FileStoreError(`local-disk read failed: ${(e as Error).message}`);
    }
  }

  /**
   * Writes an upload's body for a `put` token: to a temporary file, refusing
   * more than the token's `maxBytes`, then linked into place — atomic, and
   * never over an existing object.
   */
  async receive(token: string, body: Readable): Promise<'stored' | 'invalid' | 'too-large' | 'exists'> {
    const grant = this.signer.verify(token, 'put');
    if (!grant) return 'invalid';
    let path: string;
    try {
      path = this.pathOf(grant.fileRef);
    } catch {
      return 'invalid';
    }
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.part-${randomUUID()}`;
    const max = grant.maxBytes ?? 0;
    let received = 0;
    try {
      await new Promise<void>((resolveWrite, rejectWrite) => {
        const out = createWriteStream(temp, { flags: 'wx' });
        body.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > max) body.destroy(new Error('too-large'));
        });
        body.on('error', (e) => {
          out.destroy();
          rejectWrite(e);
        });
        out.on('error', rejectWrite);
        out.on('finish', () => resolveWrite());
        body.pipe(out);
      });
      await link(temp, path);
      return 'stored';
    } catch (e) {
      if ((e as Error).message === 'too-large') return 'too-large';
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
      throw new FileStoreError(`local-disk upload failed: ${(e as Error).message}`);
    } finally {
      await rm(temp, { force: true });
    }
  }

  private urlFor(token: string): string {
    return `${this.options.publicBaseUrl.replace(/\/+$/, '')}/${token}`;
  }

  /** Deleting an object that is already gone is not an error — the same as Supabase's `remove`. */
  async delete(fileRef: string): Promise<void> {
    try {
      await rm(this.pathOf(fileRef), { force: true });
    } catch (e) {
      throw new FileStoreError(`local-disk delete failed: ${(e as Error).message}`);
    }
  }

  /**
   * A bucket's objects ordered by `fileRef`, after `cursor`. Walks the bucket
   * directory on every call — fine for the sizes a local disk serves; a store
   * with millions of objects lists through its provider's own paging.
   */
  /** Ignores an upload still being written (`*.part-*`). */
  async listObjects(bucket: string, opts: { cursor?: string; limit: number }): Promise<{ objects: StoredObject[]; nextCursor: string | null }> {
    if (!BUCKET.test(bucket)) throw new FileStoreError(`not a bucket: ${bucket.slice(0, 64)}`);
    const bucketDir = resolve(this.root, bucket);
    const entries = await readdir(bucketDir, { recursive: true, withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return [];
      throw new FileStoreError(`local-disk list failed: ${e.message}`);
    });
    const refs = entries
      .filter((e) => e.isFile() && !/\.part-[0-9a-f-]{36}$/.test(e.name))
      .map((e) => `${bucket}/${relative(bucketDir, resolve(e.parentPath, e.name)).split(sep).join('/')}`)
      .filter((ref) => opts.cursor === undefined || ref > opts.cursor)
      .sort();
    const page = refs.slice(0, opts.limit);
    const objects = await Promise.all(
      page.map(async (fileRef) => {
        const info = await stat(this.pathOf(fileRef));
        return { fileRef, sizeBytes: info.size, modifiedAt: info.mtime };
      }),
    );
    return { objects, nextCursor: refs.length > opts.limit ? page[page.length - 1] : null };
  }

  /** Verifies a download token → the path to stream and how to serve it; `null` when forged, expired or gone. */
  async open(token: string): Promise<{ path: string; size: number; filename?: string; contentType?: string } | null> {
    const grant = this.signer.verify(token, 'get');
    if (!grant) return null;
    let path: string;
    try {
      path = this.pathOf(grant.fileRef);
    } catch {
      return null;
    }
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return null;
    return { path, size: info.size, filename: grant.filename, contentType: grant.contentType };
  }

  /** `{bucket}/{objectKey}` → an absolute path under `rootDir`, or a `FileStoreError`. */
  pathOf(fileRef: string): string {
    const slash = fileRef.indexOf('/');
    const bucket = slash > 0 ? fileRef.slice(0, slash) : '';
    const key = fileRef.slice(slash + 1);
    if (!BUCKET.test(bucket) || !key || key.includes('\u0000')) {
      throw new FileStoreError(`not a local-disk file ref: ${fileRef.slice(0, 120)}`);
    }
    const bucketDir = resolve(this.root, bucket);
    const path = resolve(bucketDir, key);
    if (!path.startsWith(bucketDir + sep)) throw new FileStoreError(`file ref escapes its bucket: ${fileRef.slice(0, 120)}`);
    return path;
  }
}
