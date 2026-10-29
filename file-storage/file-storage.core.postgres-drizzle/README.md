# file-storage.core.postgres-drizzle

The Postgres/Drizzle **metadata** backend for `file-storage` — everything that
isn't the blob. Three independently-wired concerns.

This library never runs migrations (`MODULE-STANDARD.md` dimension 7). Apply
`migrations/` (`0001_file_record` … `0006_file_record_facts`, in order — attachment
references file record) with the consuming project's own
migration tool, once `ascendra-commons.js` has delivered them; never re-export
the schema tables to `drizzle-kit` too, or it generates them a second time. Released migrations are never edited — a schema
change is the next numbered file, together with the schema and the adapter SQL.

## Tables

| Table | Written by | Notes |
|---|---|---|
| `commons_file_record` | `PostgresAttachmentStore` | one row per blob: cleaned `filename`, `scan_verdict`, `retain_until` (fixed at upload), legal hold (`held_at`/`held_by`/`hold_reason`), passive `content_hash`; text `tenant_id` |
| `commons_attachment` | `PostgresAttachmentStore` | polymorphic link to a business entity; `ON DELETE CASCADE` from `file_record` |
| `commons_file_category` | seed + `PostgresFileCategoryAdminService` | two-layer: `tenant_id IS NULL` = base (seeded), non-NULL = per-tenant override; partial unique indexes |
| `commons_file_access` | `PostgresFileAccessRecorder` | one row per download URL handed out; reads only. No foreign key — deleting a file keeps its access log |

## Retention

`PostgresFileRetentionModule.forRoot({ sqlExecutorToken, imports })` binds
`PostgresFileRetentionStore` → `POSTGRES_FILE_RETENTION_STORE`; point
`FileStorageModule.forRoot({ fileRetentionStoreToken })` at it and call
`FileRetentionService.run()` from the project's scheduler. The finds read the
partial `retain_until` index; log prunes delete in batches of 5,000.

## Modules

### `PostgresAttachmentStoreModule.forRoot({ sqlExecutorToken, imports })`
Binds `PostgresAttachmentStore` → `POSTGRES_ATTACHMENT_STORE`. `attach` and
`deleteFileCascade` are each **one writable-CTE statement** — atomic without a
transaction handle (the minimal `SqlExecutor` shape has none).

### `PostgresFileCategoryModule.forRoot({ sqlExecutorToken, seedCategories?, cacheTtlMs?, imports })`
Binds `PostgresFileCategoryRegistry` → `POSTGRES_FILE_CATEGORY_REGISTRY` (point
`FileStorageModule.forRoot({ fileCategoryRegistryToken })` at it) and
`PostgresFileCategoryAdminService` → the core `FILE_CATEGORY_ADMIN_PORT`.

- `resolve(tenantId, key)` reads a base row + one override, merges them, caches
  for `cacheTtlMs` (default 60 s; `0` disables — an admin edit is then instant).
- `seedCategories` are upserted **insert-if-absent** on boot (`source = 'seed'`,
  `tenant_id NULL`) — an admin's later edits to a seeded row survive redeploys;
  a deleted base category returns. Prefer `seedFileCategories(db, cats)` from a
  migration if you want an explicit step.
- `upsertTenantOverride` rejects any field that would make the rule *less*
  restrictive than the base (`CategoryLooseningNotAllowedError`).

### `PostgresFileStorageAdminModule.forRoot({ sqlExecutorToken, imports })`
Binds `PostgresFileAccessRecorder` → `POSTGRES_FILE_ACCESS_RECORDER` (optional —
point `FileStorageModule.forRoot({ fileAccessRecorderToken })` at it) and
`PostgresFileStorageObservabilityService` → the core
`FILE_STORAGE_OBSERVABILITY_PORT` (consumed by `file-storage.api`):
`listFiles` / `getFile` / `storageUsage` / `listOrphanedFileRecords` /
`getAccessLog` / `categoryUsage`, keyset-paginated where large.

## Retention

`FileCategory.retention` (`{ keepForDays }` | `'indefinite'`) is stored on the
base row but **nothing enforces it yet** — a lifecycle job reads it later. The
`commons_file_access.occurred_at` index supports a `DELETE … WHERE occurred_at <
now() - interval 'N days'` cron for the access log.
