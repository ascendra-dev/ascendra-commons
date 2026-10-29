# File Storage Pattern

File/document storage and a generic attachment mechanism that links an uploaded
file to any business entity — not scattered per-feature. Every part of the
system that stores or retrieves a file depends on `FileStore` (the blob) and
`AttachmentStore` (the metadata), never on a provider SDK directly.

Depends on `authorization/` also being vendored (`authorization.core` only) —
`RegistryAttachmentAuthorizer` composes with the existing `Authorizer`. Copy
both folders together.

No `applicationId` anywhere — a file lands in one application's own storage,
never a shared destination. `tenantId` *is* threaded throughout, and
`AttachmentService` enforces it on every actor-bearing path (see the security
note below).

## Packages (`MODULE-STANDARD.md` §1b)

| Package | Role | Depends on |
|---|---|---|
| **`file-storage.core`** | `FileStore` / `AttachmentStore` ports, `FileCategory` / `FileCategoryRegistry`, `FileValidator` + `RuleBasedFileValidator`, `FileScanner` + `NoopFileScanner`, `FileAccessRecorder` + `NoopFileAccessRecorder`, `SignedLinkResolver`, `RegistryAttachmentAuthorizer` + `EntityAccessChecker`, **`AttachmentService`** (the orchestration handler the vertical's controllers call), the observability + category-admin ports + DTOs, `FileStorageModule.forRoot()` token wiring. **No blob backend, no persistence.** | `@nestjs/common`, `authorization.core` |
| **`file-storage.core.supabase`** (blob Model 1) | `SupabaseFileStore` + module → `SUPABASE_FILE_STORE`. | `file-storage.core`, `@supabase/supabase-js` |
| **`file-storage.core.local-disk`** (blob, dev / single node) | `LocalDiskFileStore` + module → `LOCAL_DISK_FILE_STORE`, and the controller that serves its signed URLs (`GET /local-files/:token`). | `file-storage.core`, `authorization.core` |
| **`file-storage.core.clamav`** (scanner) | `ClamdFileScanner` — ClamAV's `clamd` over TCP `INSTREAM`; anything but OK / FOUND is `unscannable`. Module → `CLAMD_FILE_SCANNER`. | `file-storage.core` |
| **`file-storage.core.s3`** (blob Model 2) | `S3FileStore` over the app's `S3Client` — presigned GETs with safe response headers, no-overwrite puts, optional SSE / SSE-KMS, listing for the stray-blob check. | `file-storage.core`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| **`file-storage.core.postgres-drizzle`** (metadata) | 4 schemas + migrations; `PostgresAttachmentStore`; `PostgresFileCategoryRegistry` + `PostgresFileCategoryAdminService` + `seedFileCategories`; `PostgresFileAccessRecorder`; `PostgresFileStorageObservabilityService`. | `file-storage.core`, `drizzle-orm` |
| **`file-storage.api`** | Opt-in HTTP surface for an ops / compliance file-administration UI — inventory, storage usage, orphans, access log, the file-category catalog, and the two destructive ops. Gated `file.view` / `file.delete` / `file.category.manage`. | `file-storage.core`, `authorization.core` |

Dependency direction is one-way toward `.core`.

## Orchestration — who does what

`AttachmentService` (in `.core`) is the handler the vertical's own controllers
call. It does **not** do per-entity authorization — the vertical has many
upload/view endpoints keyed to different entity types, so its controllers run
`RegistryAttachmentAuthorizer` (coarse `Authorizer.can` + the per-entity
`EntityAccessChecker`) first and hand `AttachmentService` an already-authorized
`actor`.

`AttachmentService.attach` = resolve the file's `FileCategory` for the actor's
tenant → app-global `FileValidator` → per-category rules → `FileScanner`
(`infected` rejected; `unscannable` obeys the category's `onUnscannable`) →
`FileStore.upload` → `AttachmentStore.attach` (one tx) → best-effort blob
delete if the persistence write fails. `getDownloadUrl` / `deleteFile` /
`detach` / `link` / `getDownloadUrlByToken` round it out.

### Security note — the tenant boundary is enforced here

There is no RLS behind a storage blob: a real Supabase/S3 client that can mint
signed URLs uses a service-role key, which bypasses RLS. So `AttachmentService`
checks `fileRecord.tenantId === actor.tenantId` (platform admin exempt, per
`isPlatformAdmin`) on every actor-bearing path. A token download
(`getDownloadUrlByToken`) has no actor and is scoped by the token itself — the
vertical owns token issuance/validation via `SignedLinkResolver`.

## The file-category catalog

`category` is not free text — it's a key into a **database-backed, admin-mutable
catalog** (`file-storage.core.postgres-drizzle`). Each category declares its
rules (content types, size band, extension allow-list, bucket, `onUnscannable`,
signed-link expiry, retention intent). Two layers:

- **Base definitions** — developer-controlled, seeded at deploy time
  (`seedCategories` on boot, insert-if-absent, or `seedFileCategories` from a
  migration). Tenants cannot create categories.
- **Per-tenant overrides** — a tenant admin tightens the tunable fields for
  their own tenant. An override may only be *more* restrictive than the base
  (`CategoryLooseningNotAllowedError`); widening is a code change.

`file-storage.api`'s `GET /files/categories` returns the effective catalog for
the caller's tenant plus live per-category counts — the single centralized view
of every accepted upload type.

## Direct uploads — the bytes go to the bucket, not through the API

For a store that implements `DirectUploadFileStore` (S3, local-disk; not
Supabase yet), a vertical can let the client upload straight to storage:

```typescript
// 1. the vertical's own endpoint, after its own authorization
const target = await attachments.beginUpload({
  file: { filename, contentType, sizeBytes },          // declared by the client
  category: 'invoice.supporting-document',
  attachedTo: { type: 'invoice', id: invoiceId },
  actor,
});
// → { uploadId, url, method: 'PUT', headers, expiresAt } — the client PUTs the bytes with exactly `headers`

// 2. once the client says it's done
const { fileRecord } = await attachments.completeUpload({ uploadId, actor });
```

- `beginUpload` checks everything it can without the bytes — category, type,
  extension, size, the tenant's storage limit — before any URL exists, and
  records the upload (`PendingUploadStore`, migration 0008).
- The URL is bound to the declared size and type and never overwrites
  (`uploadUrlExpirySeconds`, default 900).
- `completeUpload` — only by the actor who began it — requires the object to
  be there at exactly the declared size, reads it back for the content
  signature check, the scan and the hash, checks the category and the limit
  again, and only then writes the record. Any refusal deletes the object and
  is recorded as a rejection; a second complete is a 404.
- An upload never completed is dropped, object and all, by the retention run
  once its URL has expired.

The bytes are still read back once (to check, scan and hash them) — what
leaves the API is the upload itself: the client's connection, its slowness,
and its size limits.

## Retention and legal hold

Every file's `retainUntil` is fixed at upload from its category's
`retention` (`{ keepForDays }` or `'indefinite'`) — a later catalog change
doesn't move it.

- **Before that date** a tenant actor can't delete the file (409); a platform
  admin can (an erasure request), and the audit event says `overrodeRetention`.
- **After it**, `FileRetentionService.run()` deletes it — record, attachments,
  blob — audited `file.deleted`, cause `retention`. The project schedules the
  run (a `background-jobs` `ScheduledJob`, a cron); the library never runs it
  on its own. The same run prunes the access log (`logRetention.accessLogDays`,
  default 365) and the rejection log (`rejectionLogDays`, default 90 — it
  carries filenames).
- **A legal hold** (`placeLegalHold` / `releaseLegalHold`, who + why) stops
  every delete — a person's, retention's, an orphan purge's — until released.
- **Orphans** (files with no attachment) are purged on request
  (`purgeOrphans`), never automatically; held and retained files stay.

Every delete re-checks its reason inside the statement that deletes — a hold
placed, or an attachment linked, after the file was found keeps it.

## Model 1 / Model 2

- **Blob backend** — Model 1 is `file-storage.core.supabase`; Model 2 is
  `file-storage.core.s3` (S3 and S3-compatible stores). Same `FileStore` contract.
  `file-storage.core.local-disk` is the same contract on the local filesystem —
  development, tests, the sandbox, a single-node deployment.
- **Scanning** — `NoopFileScanner` by default (every file `clean`);
  `file-storage.core.clamav` is a real one (ClamAV's daemon), bound per deployment. Streaming a large
  file past the scanner instead of buffering is a Model 2 (S3) concern.

## Consuming it

```typescript
@Module({
  imports: [
    AuthorizationModule.forRoot({ personaActions: { /* ... */ } }),

    SupabaseFileStoreModule.forRoot({
      supabaseClientToken: SUPABASE_CLIENT,
      fileStoreConfig: { buildObjectKey: ({ tenantId, category }) => `${tenantId}/${category}/${randomUUID()}` }, // never the client's filename
      imports: [DatabaseModule],
    }),
    PostgresAttachmentStoreModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
    PostgresFileCategoryModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION,
      seedCategories: [ /* base FileCategory[] */ ],
      imports: [DatabaseModule],
    }),

    FileStorageModule.forRoot({
      fileStoreToken: SUPABASE_FILE_STORE,
      attachmentStoreToken: POSTGRES_ATTACHMENT_STORE,
      fileCategoryRegistryToken: POSTGRES_FILE_CATEGORY_REGISTRY,
      fileScannerToken: MY_SCANNER,                 // optional
      fileAccessRecorderToken: POSTGRES_FILE_ACCESS_RECORDER,  // optional
      signedLinkResolverToken: MY_SIGNED_LINK_RESOLVER,        // optional
      validationDefaults: { absoluteMaxSizeBytes: 50 * 1024 * 1024, deniedExtensions: ['exe', 'sh'] },
      entityAccessCheckers: { invoice: invoiceAccessChecker },
      imports: [/* the modules above + AuthorizationModule */],
    }),

    // optional admin UI surface
    PostgresFileStorageAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
    FileStorageApiModule.forRoot({ imports: [/* the admin + category + FileStorage modules */] }),
  ],
})
export class AppModule {}
```

### The vertical's own upload endpoint

```typescript
@Post('invoices/:id/documents')
@UseInterceptors(FileInterceptor('file'))
async upload(@Param('id') invoiceId: string, @UploadedFile() file: Express.Multer.File, @CurrentActor() actor: Actor) {
  await this.attachmentAuthorizer.assertCanAttach(actor, 'invoice', invoiceId);   // the vertical owns authz
  return this.attachments.attach({
    file: { data: file.buffer, contentType: file.mimetype, filename: file.originalname, sizeBytes: file.size },
    category: 'invoice.supporting-document',
    attachedTo: { type: 'invoice', id: invoiceId },
    actor,
  });
}
```

The blob upload happens before the metadata write and is best-effort rolled
back if that write fails. A failed rollback (or a failed blob delete) leaves a
**stray blob** — bytes with no record. Two different leftovers, two checks:

- `GET /files/orphans` — *records* with no attachment (`purgeOrphans` cleans them up);
- `GET /files/stray-blobs?bucket=` — *objects* with no record, for a store that
  implements `ListableFileStore` (local-disk does; Supabase doesn't yet).
