# file-storage.core.postgres-drizzle

The Postgres/Drizzle **metadata** backend for `file-storage` — everything that
isn't the blob. Three independently-wired concerns.

This library never runs migrations (`MODULE-STANDARD.md` dimension 7). Copy the
`persistence/*.migration.sql` files into the consuming project's tooling, or
re-export the schema tables for `drizzle-kit`. Keep schema / migration / adapter
SQL in sync.

## Tables

| Table | Written by | Notes |
|---|---|---|
| `commons_file_record` | `PostgresAttachmentStore` | one row per blob; passive `content_hash`; indexes for `(tenant, category, created_at)`, cleanup, dedupe |
| `commons_attachment` | `PostgresAttachmentStore` | polymorphic link to a business entity; `ON DELETE CASCADE` from `file_record` |
| `commons_file_category` | seed + `PostgresFileCategoryAdminService` | two-layer: `tenant_id IS NULL` = base (seeded), non-NULL = per-tenant override; partial unique indexes |
| `commons_file_access` | `PostgresFileAccessRecorder` | one row per download URL handed out; reads only |

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
