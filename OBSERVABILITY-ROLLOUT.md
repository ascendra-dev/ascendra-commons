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

## 3 · notification — delivery history + config admin

**New table** `commons_notification_delivery`.

- ☐ `commons_notification_delivery` schema + migration (type, recipient, channel, tenant, status, provider_message_id, error, timestamps, application, correlation_id)
- ☐ `NotificationDeliveryRecorder` port + `NoopNotificationDeliveryRecorder`, wired into `Notifier` best-effort (like `JobRunRecorder`)
- ☐ `PostgresNotificationDeliveryRecorder` + a status-update path for provider webhooks (queued→sent→delivered/failed/bounced)
- ☐ `PostgresNotificationObservabilityService` — delivery history query; config-coverage gaps (route w/o template, routed channel w/o credential)
- ☐ config admin: CRUD on routes / templates / provider credentials; test-send
- ☐ module(s), specs, READMEs, audit doc entry

## 4 · correlation-id cross-cut

- ☐ nullable `correlation_id` column on `commons_jobs_job_run` (+ `commons_notification_delivery`)
- ☐ pluggable `CorrelationIdProvider` per recorder module; `JobTrigger` captures request context; audit already has it
- ☐ all three read services filterable by `correlationId` → cross-module trace
- ☐ docs

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
