# file-storage.api

Opt-in HTTP endpoints for an **ops / compliance file-administration UI**, over
`file-storage.core.postgres-drizzle`'s ports + `AttachmentService`.

This is **not** the per-entity upload/view/download surface — those endpoints
are keyed to business entity types with their own access rules and stay in the
vertical's own controllers (which use `RegistryAttachmentAuthorizer`). This
package is the "someone at the company looks at the file inventory" screen.

Requires `AuthorizationGuard` wired globally as `APP_GUARD` — every endpoint
declares `@RequiresAction('file.*')`.

## Endpoints

| Method | Gate | |
|---|---|---|
| `GET /files` | `file.view` | inventory — filter by tenant / category / uploader / date / size; keyset-paginated |
| `GET /files/:id` | `file.view` | one file: record + attachments + a short-lived in-app URL |
| `GET /files/:id/access-log` | `file.view` | who fetched it, when |
| `GET /files/storage-usage` | `file.view` | `SUM(bytes)` grouped by tenant + category |
| `GET /files/orphans` | `file.view` | file records with zero attachments |
| `DELETE /files/:id` | `file.delete` | hard delete (blob + all metadata, cascade) — delegates to `AttachmentService.deleteFile` |
| `DELETE /files/:id/attachments/:attachmentId` | `file.delete` | detach one link, keep the file |
| `GET /files/categories` | `file.view` | the effective catalog for the caller's tenant + live per-category counts |
| `GET /files/categories/:key` | `file.view` | base + override, shown separately |
| `PATCH /files/categories/:key` | `file.category.manage` | upsert the caller-tenant override (tightening only) |
| `DELETE /files/categories/:key` | `file.category.manage` | deactivate: a tenant's override (revert to base), or — platform admin — the base row (soft) |

No `POST /files/categories` — base category definitions come only from the
deploy-time seed.

## Actor-scoping

`isPlatformAdmin` comes from `FileStorageModule.forRoot({ isPlatformAdmin })`
(default `actor.tenantId === null`) — one setting for `AttachmentService` and
these endpoints, so the two can't disagree. A non-platform actor's reads are forced to their own `tenantId`;
`PATCH` / `DELETE` on categories are scoped to their tenant. Same pattern as
`notification.api`.

## Audit

Optional `auditEmitterToken` — records the destructive ops (file delete,
detach, category override/deactivate). File *uploads* are audited on the
`.core` side via `FileStorageModule.forRoot({ auditEmitterToken })`, where
`AttachmentService.attach` runs. This package takes no dependency on
`audit-logging`.

## Wiring

```typescript
FileStorageApiModule.forRoot({
  auditEmitterToken: MY_AUDIT_EMITTER,   // optional
  imports: [
    PostgresFileStorageAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
    PostgresFileCategoryModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
    // FileStorageModule.forRoot(...) exports AttachmentService — import it here too if not otherwise visible
  ],
})
```
