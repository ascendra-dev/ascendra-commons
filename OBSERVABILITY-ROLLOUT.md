# Observability & Administration Rollout

Living checklist for adding, per module, the read/query surface an admin UI needs
("observe") and the safe config mutations ("administer"). Pattern, matching what
`background-jobs` already ships:

- Everything lives in `<module>/adapters/postgres-drizzle/`, **flat folder**, one
  `index.ts` barrel, opt-in via a `forRoot`.
- The module ships the **service + typed DTOs**. The consuming project writes the
  HTTP controller and gates it with its own `Authorizer` — `ascendra-commons` is
  backend-pattern-only (no shipped controllers/UI).
- Reads are `application`-scoped and keyset-paginated where they can be large.
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

## 5 · domain-events — deferred

Model 1 in-process events don't persist; real observability needs a transactional
outbox (Model 2). Listener-registry introspection is the only Model 1 read and has
thin merit. Revisit when the outbox lands.

---

## Progress log

- 2026-09-06 — checklist created.
- 2026-09-06 — item 0 done (background-jobs rename/tidy). 326/326.
- 2026-09-06 — item 1 done (audit-logging `AuditEventReader` + Postgres adapter). 332/332.
- 2026-09-06 — item 2 done (authorization observability + admin services). 346/346.
- 2026-09-06 — item 3 done (notification delivery log + config admin). 363/363.
- 2026-09-06 — item 4 done (correlation-id cross-cut). 364/364. Items 0-4 complete; item 5 (domain-events) deferred by design.
- 2026-09-06 — item 6 done (notification message-content archive, light `jsonb` scope, opt-in). 368/368.
