# file-storage.core.s3

The **Model 2** `FileStore` backend — **not built**. The seam is real (its own
package, token `S3_FILE_STORE`, module, a drop-in `FileStore`); every method of
`S3FileStore` throws `S3FileStoreNotImplementedError`.

Build this when Supabase Storage's limits (object size, egress, per-bucket
policy granularity, region control) are genuinely outgrown — not before.

## Design notes for when it's built

- **Direct-to-bucket transfer.** `upload` should hand back a **presigned `PUT`**
  so the bytes never transit the API; `getUrl` returns a **presigned `GET`**
  (replacing Supabase's `createSignedUrl`). This changes `AttachmentService`'s
  `attach` shape — the scan/validate/persist dance runs around a client-side
  upload rather than a server-side `upload(Buffer)`. Decide then whether that's
  a second `attach` variant or a breaking change to the port.
- **Streaming.** Large files stream past the `FileScanner` (multipart upload +
  a streaming scan path) instead of buffering — the deferred half of the
  scanning decision.
- **Encryption.** SSE-KMS per bucket/category; the key policy is deployment
  config, not code.
- **`fileRef`.** Still `"{bucket}/{key}"` — the contract is unchanged, so
  `FileRecord` rows survive a backend swap.
- **Multipart cleanup.** Abandoned multipart uploads need a lifecycle rule or a
  reconciliation sweep, alongside the orphaned-blob story.
