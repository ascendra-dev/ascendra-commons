# file-storage.core.local-disk

A `FileStore` backend on the **local filesystem** — for development, tests, the
commons sandbox, and a single-node deployment that keeps files on its own disk.
Same `FileStore` contract as `file-storage.core.supabase`, so swapping one for
the other is a `fileStoreToken` change.

- `upload` writes `{rootDir}/{bucket}/{objectKey}` — the bucket from the file's
  `FileCategory`, the key from `FileStoreConfig.buildObjectKey` (never the
  client's filename verbatim). It never overwrites: two uploads resolving to one
  key is a `buildObjectKey` bug, and the second is a `FileStoreError`.
- Every path is resolved and checked to stay inside its bucket — a key carrying
  `../` or a bucket that isn't one plain segment is refused.
- `getUrl` signs a short-lived token (HMAC-SHA256 over the file ref, expiry and
  how to serve it) → `{publicBaseUrl}/{token}`. The token is the whole grant.
- The module registers a controller at `GET /{routePath}/:token` (default
  `local-files`) that verifies the token and streams the bytes:
  - inline only for PDF, PNG, JPEG, GIF, WebP and plain text; anything else
    (HTML, SVG, …) downloads as an attachment, so an upload never runs as a page;
  - always `X-Content-Type-Options: nosniff`, a sandboxing CSP, `no-store`;
  - `Content-Disposition` carries the record's filename (RFC 6266, UTF-8 safe);
  - a forged or expired token is a 403.
- `delete` of an object already gone is not an error (as Supabase's `remove`).
- **Direct uploads** (`DirectUploadFileStore`): `createUploadUrl` signs a `put`
  token (a download token can't upload, nor the reverse) served at
  `PUT /{routePath}/:token`. The client sends `Content-Type:
  application/octet-stream` (the returned headers say so — the app's JSON and
  form body parsers then leave the stream alone). The body goes to a temporary
  file, is refused past the declared size (413), and is linked into place —
  atomic, never over an existing object (409).

## Wiring

```typescript
LocalDiskFileStoreModule.forRoot({
  rootDir: resolve('var/files'),                        // absolute
  publicBaseUrl: 'http://localhost:3010/local-files',   // where routePath is reachable — or '/api/local-files' behind the app's proxy
  signingSecret: process.env.FILES_SIGNING_SECRET!,     // ≥ 32 characters
  fileStoreConfig: { buildObjectKey: ({ tenantId, category }) => `${tenantId}/${category}/${randomUUID()}` },
  routeDecorators: [Public()],                          // your auth guard's "no login" marker — the token is the grant
})
// → binds LOCAL_DISK_FILE_STORE; point FileStorageModule.forRoot({ fileStoreToken: LOCAL_DISK_FILE_STORE }) at it
```

The serving route declares `@NoActionRequired()` for `AuthorizationGuard`;
`routeDecorators` is for the app's own authentication guard, which this
library can't know.

## Not for

Several API nodes behind a load balancer without a shared volume — each node
sees only its own disk. Use Supabase (or S3) there.
