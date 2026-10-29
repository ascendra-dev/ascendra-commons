import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import {
  downloadHeaders,
  FILE_STORE_CONFIG,
  FileStoreError,
  type FileStoreConfig,
  type ListableFileStore,
  type StoredObject,
} from '../file-storage.core';
import { S3_CLIENT, S3_FILE_STORE_OPTIONS } from './tokens';

export interface S3FileStoreOptions {
  /** Server-side encryption for every object written. Omit to use the bucket's default. */
  serverSideEncryption?: 'AES256' | 'aws:kms';
  /** The KMS key for `aws:kms` — omit to use the account's default S3 key. */
  kmsKeyId?: string;
  /**
   * Refuse to overwrite an existing key (`If-None-Match: *`) — the same as the
   * other stores. Default `true`; turn off only for an S3-compatible store
   * that rejects conditional writes.
   */
  preventOverwrite?: boolean;
}

function splitFileRef(fileRef: string): { Bucket: string; Key: string } {
  const slash = fileRef.indexOf('/');
  if (slash <= 0 || slash === fileRef.length - 1) throw new FileStoreError(`not an S3 file ref: ${fileRef.slice(0, 120)}`);
  return { Bucket: fileRef.slice(0, slash), Key: fileRef.slice(slash + 1) };
}

/**
 * Model 2 blob backend — Amazon S3, or anything that speaks its API (MinIO,
 * R2, …), through the app's own `S3Client`. `fileRef` is `"{bucket}/{key}"`,
 * the same contract as every store, so records survive a backend swap.
 *
 * - `upload` → `PutObject` with the record's content type, optional SSE, and
 *   `If-None-Match: *` (never overwrite).
 * - `getUrl` → a presigned `GetObject` that sets `Content-Type` and
 *   `Content-Disposition` on the response: inline for the safe few types,
 *   an attachment otherwise, with the record's filename.
 * - `listObjects` → `ListObjectsV2` (the stray-blob check).
 * - Provider errors become `FileStoreError`, never the raw SDK error.
 */
@Injectable()
export class S3FileStore implements ListableFileStore {
  constructor(
    @Inject(S3_CLIENT) private readonly client: S3Client,
    @Inject(FILE_STORE_CONFIG) private readonly config: FileStoreConfig,
    @Inject(S3_FILE_STORE_OPTIONS) private readonly options: S3FileStoreOptions,
  ) {}

  async upload(
    file: Buffer,
    meta: { contentType: string; filename: string; category: string; tenantId: string | null; bucket: string },
  ): Promise<{ fileRef: string }> {
    const Key = this.config.buildObjectKey({ tenantId: meta.tenantId, category: meta.category, filename: meta.filename });
    await this.call('upload', () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: meta.bucket,
          Key,
          Body: file,
          ContentType: meta.contentType,
          ContentLength: file.length,
          ...(this.options.preventOverwrite !== false ? { IfNoneMatch: '*' } : {}),
          ...(this.options.serverSideEncryption ? { ServerSideEncryption: this.options.serverSideEncryption } : {}),
          ...(this.options.kmsKeyId ? { SSEKMSKeyId: this.options.kmsKeyId } : {}),
        }),
      ),
    );
    return { fileRef: `${meta.bucket}/${Key}` };
  }

  async getUrl(
    fileRef: string,
    opts?: { expirySeconds?: number; filename?: string | null; contentType?: string },
  ): Promise<string> {
    const { type, disposition } = downloadHeaders(opts?.contentType, opts?.filename);
    return this.call('getUrl', () =>
      getSignedUrl(
        this.client,
        new GetObjectCommand({ ...splitFileRef(fileRef), ResponseContentType: type, ResponseContentDisposition: disposition }),
        { expiresIn: opts?.expirySeconds ?? 300 },
      ),
    );
  }

  /** S3's `DeleteObject` succeeds for a key already gone — the same as the other stores. */
  async delete(fileRef: string): Promise<void> {
    await this.call('delete', () => this.client.send(new DeleteObjectCommand(splitFileRef(fileRef))));
  }

  async listObjects(bucket: string, opts: { cursor?: string; limit: number }): Promise<{ objects: StoredObject[]; nextCursor: string | null }> {
    const startAfter = opts.cursor?.startsWith(`${bucket}/`) ? opts.cursor.slice(bucket.length + 1) : undefined;
    const page = await this.call('listObjects', () =>
      this.client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: opts.limit, StartAfter: startAfter })),
    );
    const objects = (page.Contents ?? [])
      .filter((o) => o.Key)
      .map((o) => ({ fileRef: `${bucket}/${o.Key}`, sizeBytes: Number(o.Size ?? 0), modifiedAt: o.LastModified ?? new Date(0) }));
    return { objects, nextCursor: page.IsTruncated && objects.length ? objects[objects.length - 1].fileRef : null };
  }

  private async call<T>(op: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof FileStoreError) throw e;
      throw new FileStoreError(`s3 ${op} failed: ${(e as Error).name}: ${(e as Error).message}`);
    }
  }
}
