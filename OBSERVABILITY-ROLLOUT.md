# Observability & Administration Rollout

Living checklist for adding, per module, the read/query surface an admin UI needs
("observe") and the safe config mutations ("administer"). Pattern, matching what
`background-jobs` already ships:

- For a single-folder module: everything lives in
  `<module>/adapters/postgres-drizzle/`, **flat folder**, one `index.ts` barrel,
  opt-in via a `forRoot`.
- **For a module split into packages (MODULE-STANDARD §1b, e.g. `authorization`
  as of 2026-09-07):** the **port** (interface + DTOs) lives in the
  `.core.<family>` package; the **implementation** lives in the stack adapter's
  `admin/` sub-folder; the HTTP **endpoints** live in the `.api` package. A
  second Model 2 stack re-implements the port, nothing else.
- The module ships the **service + typed DTOs** (and, for a split module, the
  `.api` controllers too — MODULE-STANDARD dimension 8). Reads are
  `application`-scoped and keyset-paginated where they can be large.
- Read services never mutate; admin operations are separate, explicit methods.

Status key: ☐ todo · ◐ in progress · ☑ done

---

## 0 · background-jobs — rename + tidy ☑ (2026-09-06)

- ☑ `job-status.*` → `job-observability.*` (5 files)
- ☑ `PostgresJobStatusModule/Service/ModuleConfig` → `PostgresJobObservability*`; `JOB_STATUS_CADENCES` → `JOB_OBSERVABILITY_CADENCES`
- ☑ `scheduler-lock.*` → `lease-lock.*`; `schedulerLockTable` → `leaseLockTable` (one prefix for the lock concern)
- ☑ `index.ts`, both READMEs, `MODULE-STANDARD-AUDIT.md`
- ☑ 326/326 tests, typecheck clean

## 1 · audit-logging — read API (the deferred `AuditQuery`) ☑ (2026-09-06)

No new table. No admin surface — records are write-once.

- ☑ `AuditEventReader` port + `AuditQuery` / `AuditQueryResult` DTOs (separate port, not a method on `AuditEventRepository`)
- ☑ `PostgresAuditEventReader` — filters: entityType+entityId, tenantId (absent vs null), actor, action, correlationId, occurredAfter/Before; keyset pagination on (occurred_at, id)
- ☑ `PostgresAuditObservabilityModule.forRoot({ sqlExecutorToken, application, imports })`
- ☑ specs (`postgres-audit-event-reader.spec.ts`, `postgres-audit-observability.module.spec.ts`)
- ☑ adapter README + module README ("Not built: reading audit records" → built); `application` now filtered-on (schema comment + Notes updated)
- ☑ audit doc entry · 332/332 tests

## 2 · authorization — access explainer + assignment admin ☑ (2026-09-06)

No new table.

- ☑ `PostgresAuthzObservabilityService`: `explainAccess(userId, tenantId, action?)` (roles + delegations + effective set + allowed/reason), `listRoles()`, `listUserRoleAssignments()`, `listDelegations()` (paginated), `actionCatalogHealth(knownActions)`
- ☑ `PostgresAuthzAdminService`: `assignRole` (→ `RoleNotFoundError`) / `revokeRole` / `setActionDescription` (→ `ActionNotFoundError`). `revokeDelegation` stays in `DelegationService`.
- ☑ `PostgresAuthzAdminModule.forRoot({ sqlExecutorToken, imports })` → `POSTGRES_AUTHZ_OBSERVABILITY` / `POSTGRES_AUTHZ_ADMIN`
- ☑ specs (observability, admin, module — 14 tests)
- ☑ adapter README ("Admin surface") + module README (shipped/deferred table)
- ☑ audit doc entry · 346/346

## 3 · notification — delivery history + config admin ☑ (2026-09-06)

**New table** `commons_notification_delivery`.

- ☑ schema + migration (id, application, notification_type, channel, tenant_id, recipient_ref *redacted*, status, reason, provider_message_id, attempted_at, updated_at, correlation_id)
- ☑ `NotificationDeliveryRecorder` port + `NoopNotificationDeliveryRecorder`, wired into `Notifier` best-effort; `NotificationChannelResult.providerMessageId?` added
- ☑ `PostgresNotificationDeliveryRecorder` — batched INSERT + `updateDeliveryStatus` (webhook: sent→delivered/bounced)
- ☑ `PostgresNotificationObservabilityService` — `getDeliveryHistory` (paginated) + `configCoverageGaps` (route w/o template, tenant route w/o credential)
- ☑ `PostgresNotificationConfigAdminService` — CRUD routes/templates/credentials (creds list redacted). Test-send = call `Notifier.notify()` (documented, not a method).
- ☑ `PostgresNotificationDeliveryRecorderModule` + `PostgresNotificationAdminModule`, specs, READMEs, audit doc · 363/363

## 4 · correlation-id cross-cut ☑ (2026-09-06)

- ☑ `commons_jobs_job_run.correlation_id` column (schema/migration/INSERT/`JobRunSummary`); `commons_notification_delivery` already had it; `commons_audit_event` already had it + `persistAuditRecord` populates it
- ☑ threading: `JobRunOptions.correlationId` → `JobTrigger.trigger(name, correlationId)`; `NotificationRequest.correlationId` → `Notifier` → delivery row. **Caller-supplied**, no cross-module dep / no ALS magic.
- ☑ all three read services filter by `correlationId` (`RunHistoryQuery`, `AuditQuery`, `DeliveryHistoryQuery`)
- ☑ READMEs — "Cross-module trace" notes in bg-jobs + notification adapters · 364/364

## 6 · notification — message content archive (light scope) ☑ (2026-09-06)

"Save the sent notification for later reference" — the **light** scope: a
nullable `content jsonb` column on `commons_notification_delivery`, pruned with
the row. (A long-retention / legal archive would use `file-storage` + an async
job — deliberately not this.)

- ☑ `NotificationChannelResult.rendered?` — email/SMS senders return the rendered subject/body; `Notifier` builds `DeliveryAttempt.content` from it + `request.variables`. `rendered` is stripped from the public `notify()` result (plumbing only, PII-bearing).
- ☑ `commons_notification_delivery.content jsonb` nullable (`DeliveryContent = { subject, body, isHtml, variables }`)
- ☑ `PostgresNotificationDeliveryRecorderModule.forRoot({ storeContent?: boolean })` — default **false**; when false the column is written NULL even if the attempt carries content
- ☑ `PostgresNotificationObservabilityService.getDeliveryContent(id)` (off the list query — large/PII); `DeliveryRecord.hasContent` boolean on the list
- ☑ specs, README notes · 368/368

## 5 · domain-events — observability deferred; **package split done 2026-09-07**

Observability: Model 1 in-process events don't persist; real observability needs a
transactional outbox (Model 2). Deferred.

Package split (separate from observability): `domain-events` split into `.core` /
`.core.in-process` / `.core.broker` on the strength of the `transport:` Model 1/2
seam alone (MODULE-STANDARD §1b — a real shipped selector+interface+token is a
sufficient split signal). `forRoot()` is token-only (`emitterToken`); the
`transport` string is gone; `application` + `DOMAIN_EVENTS_APPLICATION_ID` moved
to `.core.broker` (a broker-only concern). No `.api`. `audit-logging`'s
`../../domain-events` imports now target `domain-events.core` (+ `.core.in-process`
for the transport in its specs). 454/454.

## 7 · idempotency-key — package split + Model 1 locking hardening ☑ (2026-09-07)

Split into `.core` / `.core.postgres-drizzle` / `.core.redis` (the Redis store is
a throwing stub — the seam was *made* real, `forRoot({ storeToken })` token-only).
**Model 1 locking hardening:** (a) the defensive fallback re-INSERT was a plain
`INSERT` that PK-violated → 500 under a delete-then-double-claim race — now
`ON CONFLICT DO NOTHING RETURNING` + re-read; (b) a new `claim_id` ownership
token — `complete(key, scope, claimId, response)` is guarded `WHERE claim_id = $`,
so an evicted-then-slow claimer's late `complete()` no-ops instead of corrupting
the current owner's cached response; (c) `forRoot` throws unless
`staleAfterSeconds > 0`; (d) `SqlExecutor` → `{ rows }`-only, check `rows.length`
not `rowCount`. **Migration:** `idempotency-key.schema.ts` + `.migration.sql`
added (the module had none) — with `claim_id` and a `created_at` index for the
24h cleanup. 461/461.

## 8 · file-storage — observability + administration + package split ☑ (2026-09-07)

**New tables** `commons_file_record`, `commons_attachment`, `commons_file_category`,
`commons_file_access` (the module previously shipped *no* persistence — `AttachmentStore`
was a port with no adapter).

Split into `.core` / `.core.supabase` / `.core.s3` (throwing stub — the
S3/"provider portability" Model 2 seam made real) / `.core.postgres-drizzle` / `.api`.

- ☑ `.core`: `FileStore`/`AttachmentStore` ports (`AttachmentStore` gained `link`/`detach`/`getById`/`deleteFileCascade`), `AttachmentService` orchestration handler (validate → scan → upload → persist; best-effort blob cleanup on persistence failure; **tenant-isolation on every actor-bearing path** — no RLS behind storage objects), `FileValidator` + `RuleBasedFileValidator` (app-global ceiling/denylist), `FileScanner` + `NoopFileScanner` (verdict `clean`/`infected`/`unscannable`, per-category `onUnscannable` policy), `FileAccessRecorder` + `NoopFileAccessRecorder`, `SignedLinkResolver` + `MissingSignedLinkResolver`, `FileCategory`/`FileCategoryRegistry`, `FileStorageObservabilityPort` + `FileCategoryAdminPort` + DTOs, keyset cursor helper, `FileStorageModule.forRoot` token-only
- ☑ `.core.postgres-drizzle`: 4 schemas + migrations; `PostgresAttachmentStore` (writable-CTE `attach`/`deleteFileCascade` — atomic without a tx handle); `PostgresFileCategoryRegistry` (two-layer base + per-tenant-override merge, TTL cache) + `PostgresFileCategoryAdminService` (override may only *tighten* — `CategoryLooseningNotAllowedError`) + `seedFileCategories` (insert-if-absent on boot); `PostgresFileAccessRecorder`; `PostgresFileStorageObservabilityService` (`listFiles`/`getFile`/`storageUsage`/`listOrphanedFileRecords`/`getAccessLog`/`categoryUsage`, keyset-paginated)
- ☑ `.api`: `GET /files` (+ `/:id`, `/:id/access-log`, `/storage-usage`, `/orphans`), `DELETE /files/:id`, `DELETE /files/:id/attachments/:aid`; `GET /files/categories` (+ `/:key`), `PATCH /files/categories/:key`, `DELETE /files/categories/:key`. Gated `file.view` / `file.delete` / `file.category.manage`; `notification.api`-style tenant-scoping; optional `auditEmitterToken` on the destructive ops. **No per-entity endpoints** — those stay in the vertical.
- ☑ specs (115 file-storage tests, real-DI boots per package) · docs (this file, `MODULE-STANDARD` §1b, `README`, per-package READMEs) · 544/544

---

## Progress log

- 2026-09-06 — checklist created.
- 2026-09-06 — item 0 done (background-jobs rename/tidy). 326/326.
- 2026-09-06 — item 1 done (audit-logging `AuditEventReader` + Postgres adapter). 332/332.
- 2026-09-06 — item 2 done (authorization observability + admin services). 346/346.
- 2026-09-06 — item 3 done (notification delivery log + config admin). 363/363.
- 2026-09-06 — item 4 done (correlation-id cross-cut). 364/364. Items 0-4 complete; item 5 (domain-events) deferred by design.
- 2026-09-06 — item 6 done (notification message-content archive, light `jsonb` scope, opt-in). 368/368.
- 2026-09-07 — `authorization` split into `.core` / `.core.static-map` / `.core.permission-table` (+ `.postgres-drizzle`) / `.api` packages (MODULE-STANDARD §1b). Observability/admin services now implement family ports; `authorization.api` ships the HTTP surface. 413/413.
- 2026-09-07 — `notification` split the same way: `.core` / `.core.static` / `.core.database` (+ `.postgres-drizzle`) / `.api`. Delivery-log + config-admin services implement `NotificationObservabilityPort` / `NotificationConfigAdminPort` in `notification.core.database`; `notification.api` ships deliveries/coverage-gaps reads, route/template/credential CRUD, and `POST /test-send`. 433/433.
- 2026-09-07 — `audit-logging` split into `.core` / `.core.postgres-drizzle` / `.api` (no family — no Model 1/2 config split; both ports + DTOs + cursor helper are stack-agnostic `.core` contracts). `PostgresAuditEventReader` binds under the core `AUDIT_EVENT_READER` token; `audit-logging.api` ships `GET /audit/events` + `/entities/:type/:id/history` + `/trace/:correlationId`, read-only, tenant-scoped for non-platform actors. 445/445.
- 2026-09-07 — `file-storage` split into `.core` / `.core.supabase` / `.core.s3` / `.core.postgres-drizzle` / `.api` — first module to use rows on two axes (blob backend Model 1/2 + a metadata stack adapter) and to ship an orchestration handler (`AttachmentService`) in `.core`. Added all persistence the module never had, a DB-backed admin-mutable file-category catalog (base + per-tenant tightening-only overrides), a download access log, and the ops/compliance `.api`. 544/544.
- 2026-09-07 — `background-jobs` split into `.core` / `.core.postgres-drizzle` / `.api` (no family). `PostgresAdvisoryLock` moved out of `.core` (now `advisoryLockToken` is required); new `JobObservabilityPort` in `.core` (`getRunHistory` / `listJobStatus`), `PostgresJobObservabilityService` binds under `JOB_OBSERVABILITY_PORT`. `background-jobs.api` ships `GET /jobs` (dashboard) + `/jobs/:name/runs` + `/jobs/runs/trace/:correlationId` + `POST /jobs/:name/run` (JobTrigger, optional audit emitter). No tenant scoping. 454/454.
