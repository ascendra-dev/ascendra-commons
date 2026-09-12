# file-storage.core

The backend-agnostic contract for `file-storage` — **no blob backend, no
persistence**. See the container `file-storage/README.md` for the whole
picture.

## What's here

- **`FileStore`** (`file-store.port.ts`) — the blob port: `upload(Buffer, meta)`
  / `getUrl` / `delete`. `meta.bucket` is supplied by the caller (resolved from
  the file's `FileCategory`), not derived here.
- **`AttachmentStore`** (`attachment-store.port.ts`) — the metadata port:
  `attach` (atomic FileRecord + first Attachment), `link`, `detach`,
  `getFileRecordById` / `getAttachmentById`, `findByEntity`, `deleteFileCascade`.
- **`FileRecord`** / **`Attachment`** — two rows on purpose: a blob exists vs.
  it's linked to an entity. `FileRecord` carries a passive `contentHash`.
- **`FileCategory`** / **`ResolvedFileCategory`** / **`FileCategoryRegistry`** —
  the catalog contract; the DB-backed implementation is in
  `file-storage.core.postgres-drizzle`.
- **`FileValidator`** + **`RuleBasedFileValidator`** — the app-global upload gate
  (hard size ceiling, MIME/extension denylist). Always applied *in addition to*
  per-category rules.
- **`FileScanner`** + **`NoopFileScanner`** — `scan()` → `clean` / `infected` /
  `unscannable`. The Noop reports everything `clean` (today's behaviour); bind a
  real scanner in production.
- **`FileAccessRecorder`** + **`NoopFileAccessRecorder`** — best-effort download
  access log (reads only).
- **`SignedLinkResolver`** + **`MissingSignedLinkResolver`** — opaque token →
  `fileRecordId`; the default throws until the consumer binds one.
- **`RegistryAttachmentAuthorizer`** + **`EntityAccessChecker`** — tools the
  vertical's *own* controllers use for per-entity authorization. `AttachmentService`
  does not call them.
- **`AttachmentService`** — the orchestration handler: `attach` / `link` /
  `detach` / `deleteFile` / `getDownloadUrl` / `getDownloadUrlByToken`.
  Enforces the tenant boundary on every actor-bearing path (no RLS behind a
  storage blob).
- **`FileStorageObservabilityPort`** / **`FileCategoryAdminPort`** + DTOs —
  implemented by a stack adapter, consumed by `file-storage.api`.
- **`FileStorageModule.forRoot()`** — pure token wiring. Requires
  `fileStoreToken`, `attachmentStoreToken`, `fileCategoryRegistryToken`; defaults
  the five optional hooks; resolves `isPlatformAdmin` + download-URL expiry.

## `applicationId` / `tenantId`

No `applicationId`. `tenantId` is on `FileRecord` and threaded through
`AttachmentService`, which is the *only* enforcement of "tenant A never reads
tenant B's file" — a service-role storage client bypasses RLS.
