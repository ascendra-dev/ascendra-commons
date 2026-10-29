# file-storage.core.s3

The **Model 2** `FileStore` backend — Amazon S3, or anything that speaks its
API (MinIO, Cloudflare R2, …), through the app's own `S3Client`. Same
`FileStore` contract as Supabase and local-disk: `fileRef` is
`"{bucket}/{key}"`, so `FileRecord` rows survive a backend swap.

- `upload` → `PutObject` with the record's content type, `If-None-Match: *`
  (never overwrite — `preventOverwrite: false` for a store that rejects
  conditional writes) and optional server-side encryption (`AES256`, or
  `aws:kms` with an optional `kmsKeyId`).
- `getUrl` → a presigned `GetObject` that sets the response's `Content-Type`
  and `Content-Disposition`: inline for PDF and the common image types,
  an `application/octet-stream` attachment otherwise, with the record's
  filename — an uploaded HTML or SVG never renders on the bucket's origin.
- `delete` → `DeleteObject` (succeeds for a key already gone).
- `listObjects` → `ListObjectsV2` — the stray-blob check works on S3.
- Provider errors become `FileStoreError`, never the raw SDK error.

Build trigger, met: Supabase Storage's limits (object size, egress, region
control, per-bucket policy) outgrown, or a deployment already on AWS.

## Wiring

```typescript
// the app's own client — region, credentials (an IAM role in production), endpoint for MinIO / R2
{ provide: S3_CLIENT_TOKEN, useFactory: () => new S3Client({ region: 'eu-west-1' }) }

S3FileStoreModule.forRoot({
  s3ClientToken: S3_CLIENT_TOKEN,
  fileStoreConfig: { buildObjectKey: ({ tenantId, category }) => `${tenantId}/${category}/${randomUUID()}` },
  serverSideEncryption: 'aws:kms',      // optional
  imports: [AwsModule],
})
// → binds S3_FILE_STORE; point FileStorageModule.forRoot({ fileStoreToken: S3_FILE_STORE }) at it
```

npm: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

The bucket needs no public access — every read is a presigned URL. Give the
API's role `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` and
`s3:ListBucket` on the buckets the catalog names (and `kms:GenerateDataKey` /
`kms:Decrypt` on the key, for SSE-KMS).
