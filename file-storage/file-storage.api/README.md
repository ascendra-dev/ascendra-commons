# file-storage.api

Opt-in HTTP endpoints for an **ops / compliance file-administration UI**, over
`file-storage.core.postgres-drizzle`'s ports + `AttachmentService`.

This is **not** the per-entity upload/view/download surface — those endpoints
are keyed to business entity types with their own access rules and stay in the
vertical's own controllers (which use `RegistryAttachmentAuthorizer`). This
package is the "someone at the company looks at the file inventory" screen.

Requires `AuthorizationGuard` wired globally as `APP_GUARD` — every endpoint
declares `@RequiresAction('file.*')`, and every controller fails closed without
the guard (`AuthorizationEnforcedGuard`).

## Endpoints

| Method | Gate | |
|---|---|---|
| `GET /files` | `file.view` | inventory — filter by tenant / category / uploader / date / size / `held` / filename `search`; keyset-paginated |
| `GET /files/:id` | `file.view` | one file: record + attachments — metadata only, no URL |
| `POST /files/:id/download-url` | `file.view_content` | `{ url, expiresAt }` — a short-lived in-app URL; access-logged and audited (`file.content_viewed`) |
| `GET /files/:id/access-log` | `file.view` | who fetched it, when |
| `GET /files/storage-usage` | `file.view` | `SUM(bytes)` grouped by tenant + category |
| `GET /files/orphans` | `file.view` | file records with zero attachments |
| `GET /files/stats` | `file.view` | the Overview — whole calendar days (`windowDays` 1–366, default 30) in `?tz=` (IANA, default UTC): uploads and refusals per day, by category, by scan verdict, refusals by reason; totals |
| `GET /files/duplicates` | `file.view` | same-content files within a tenant (SHA-256), most wasted bytes first — reported, never merged |
| `GET /files/rejections` | `file.view` | refused uploads — filter by category / reason |
| `GET /files/retention` | `file.view` | Volume & retention: files (past retention, expiring in 30 days, indefinite, held), both logs, the log policy |
| `POST /files/retention/run` | `file.delete` | one retention pass now — platform admins only (it spans every tenant) |
| `GET /files/stray-blobs?bucket=` | `file.view` | objects in a bucket with no file record (older than an hour) — one store page per call, follow `nextCursor`. Platform only; 501 when the store can't list (Supabase today) |
| `DELETE /files/stray-blobs?fileRef=` | `file.delete` | delete one stray blob; 409 if a record holds it. Platform only |
| `POST /files/orphans/purge` | `file.delete` | body `{ olderThanDays, tenantId? }` — delete files with no attachment; held or retained files stay. Tenant-scoped |
| `DELETE /files/:id` | `file.delete` | hard delete (blob, record and attachments; the access log stays). 409 while held, or — for a tenant actor — before its retention date |
| `DELETE /files/:id/attachments/:attachmentId` | `file.delete` | detach one link, keep the file; 404 if the attachment isn't on this file |
| `PUT /files/:id/hold` | `file.hold` | place a legal hold — body `{ reason }`; 409 when already held |
| `DELETE /files/:id/hold` | `file.hold` | release it; 409 when not held |
| `GET /files/quotas` | `file.view` | per-tenant storage limits with usage — a tenant admin sees their own |
| `PUT /files/quotas/:tenantId` | `file.quota.manage` | body `{ maxBytes }` — set a limit; platform only. An upload that would pass it is a 422 and a `quota-exceeded` rejection |
| `DELETE /files/quotas/:tenantId` | `file.quota.manage` | remove it; 404 when there is none. Platform only |
| `GET /files/categories` | `file.view` | the effective catalog for the caller's tenant + live per-category counts |
| `GET /files/categories/:key` | `file.view` | base + override, shown separately |
| `PATCH /files/categories/:key` | `file.category.manage` | upsert a tenant override (tightening only; `null` clears a field). A platform admin with no `tenantId`: `{ "active": true }` turns a deactivated base back on |
| `DELETE /files/categories/:key` | `file.category.manage` | deactivate: a tenant's override (revert to base), or — platform admin — the base row (soft) |

Lists answer api-contract.md Rule 4: `{ data, meta: { nextCursor } }`. A bad
parameter — a non-uuid id, an unparseable date, `limit` outside 1–200, an
unknown `reason`, a cursor the list never issued, an unknown or mistyped body
field — is a 400 naming it; an unknown file, attachment or category is a 404.

No `POST /files/categories` — base category definitions come only from the
deploy-time seed.

## Actor-scoping

`isPlatformAdmin` comes from `FileStorageModule.forRoot({ isPlatformAdmin })`
(default `actor.tenantId === null`) — one setting for `AttachmentService` and
these endpoints, so the two can't disagree. A non-platform actor's reads are forced to their own `tenantId`;
`PATCH` / `DELETE` on categories are scoped to their tenant. Same pattern as
`notification.api`.

## Audit

Optional `auditEmitterToken` — records what only this package does: a content
view (`file.content_viewed`) and catalog changes (`file.category_override_set`,
`file.category_deactivated`, `file.category_activated`), each against the tenant
it touched, with the before/after. Deletes, detaches and legal holds are
audited once, on the `.core` side via `FileStorageModule.forRoot({ auditEmitterToken })`,
where `AttachmentService` runs. This package takes no dependency on
`audit-logging`.

## Names

Optional `userDirectoryToken` — a `FileStorageUserDirectory`
(`findByIds(ids) → { id, name }[]`) over the app's own users. Bound, inventory
rows carry `uploadedByName`, a file `uploadedByName` / `heldByName`, access-log
and rejection rows `actorName` — one call per page. Unbound, or failing, they
are `null` and the console shows the id.

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
