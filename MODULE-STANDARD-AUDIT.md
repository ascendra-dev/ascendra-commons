# Module Standard — Audit Log

## Document Control

| Version | Date | Reason |
|---------|------|--------|
| 1.0 | 2026-09-04 | First audit pass, all seven modules, against `MODULE-STANDARD.md` v1.0. |

Tracks the state of each module against `MODULE-STANDARD.md`'s eleven
dimensions over time. A fresh audit appends a new dated section below rather
than overwriting the last one — this file is a history, not just a current
snapshot. Only real findings are tracked here (a Gap or a follow-up decision);
a module passing a dimension isn't itself news on a later pass unless
something changed.

---

## 2026-09-04 — Audit 1

Performed after `domain-events`, `notification`, and `authorization` each grew
an `application`/`tenantId` seam this session. The other four modules
(`background-jobs`, `audit-logging`, `file-storage`, `idempotency-key`) were
read fresh against the standard for the first time here.

### Summary table

| Module | 1 Export | 2 Pkg | 3 forRoot | 4 appId | 5 tenantId | 6 M1/M2 | 7 Persist | 8 UI | 9 Naming | 10 Test | 11 Upgrade |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `domain-events` | Pass | Pass | Pass | Pass (origin) | N/A | Pass | N/A | N/A | Pass | Pass | Pass |
| `notification` | Pass | Pass | Pass | N/A | Pass | Pass | Pass | Pass | Pass | Pass | Pass |
| `authorization` | Pass | Pass | Pass | N/A | Pass | Pass | N/A | Pass | Pass | Pass | Pass |
| `background-jobs` | Pass | Pass | Pass | N/A | N/A | Pass | Pass | N/A | Pass (corrected) | Pass | Pass |
| `audit-logging` | Pass | Pass | Pass | N/A (watch) | Pass | Pass | Pass | Pass (fixed) | Pass | Pass | Pass |
| `file-storage` | Pass | Pass | Pass | N/A | Pass | Pass | Pass | Pass | Pass | Pass | Pass |
| `idempotency-key` | Pass | Pass | Pass | N/A | Pass (via `scope`) | Pass | Pass | Pass | N/A | Pass | Pass |

### Findings

1. **`audit-logging` — no read/query contract behind the "activity feed" mention.**
   `AuditEventRepository` shipped `insert()` only; the Overview named an
   activity-feed concept with nothing backing it if a consumer actually needed
   to query records. **Status: fixed** — Model 1's shipped-list now states "no
   read/query API" as an explicit limitation, and a new "Not built: reading
   audit records" section documents the deferred shape (`AuditQuery`,
   `AuditEventRepository.find()`), mirroring `background-jobs`' `JobRunSummary`
   treatment: prose only, no interface change, no stub — consistent with
   dimension 6's default.

2. **`background-jobs` — naming-convention comparison overclaimed.** The README
   compared job `name` to `Actions`' dot-notation convention, but the worked
   example uses kebab-case (`'invoice-reminder'`) — a job name isn't a
   resource+verb pair the way an action is. **Status: fixed** — reworded to
   name the actual shared property (one const catalog, so a typo is a compile
   error), not the string format.

3. **`audit-logging` is the one module where `applicationId` is a plausible
   near-term ask** — centralized cross-product audit/compliance reporting is a
   standard real-world request, more concrete than any other module's
   shared-destination story. **Status: noted, not built** — correctly N/A today
   (no concrete signal), flagged as "the one to watch" in its own README, with
   a note that `APPLICATION_ID` is already free to inject (via the existing
   `domain-events` dependency) if the story lands — no new token needed.

4. **Six of seven modules were silent on dimensions 4 and 5** rather than
   stating "N/A, here's why" explicitly. **Status: fixed** — every module's
   README now states its position on both explicitly (`domain-events` was
   already explicit on 4 from this session's earlier work; its own dimension-5
   N/A — a `DomainEvent`'s tenancy is a payload-specific fact each concrete
   event class carries itself, not something the transport needs to know — was
   added too).

5. **`idempotency-key` satisfies dimension 5 already, via `scope`, without
   saying so.** `scope` already carries tenant/actor identity more flexibly
   than a bare `tenantId` field would (pluggable per-endpoint via
   `IdempotencyScopeResolver`). **Status: fixed** — README now states this
   explicitly rather than leaving it to be inferred.

6. **No module's README pointed at `MODULE-STANDARD.md`.** **Status: fixed** —
   every module now carries a one-line pointer, the same way each already
   points at `module-packaging-pattern.md`.

### Open items carried to next audit

None. All findings from this pass were resolved within it.

---

## 2026-09-04 — Correction

Caught immediately after Audit 1 closed: `domain-events`' own dimension-4
implementation didn't actually follow dimension 4 as written. `application`
had been made a **required** `forRoot()` field under both transports, but
`InProcessDomainEventEmitter` never reads it — only `BrokerDomainEventEmitter`
does. Every in-process consumer (the only transport actually in use anywhere
today) was paying a required-config cost for a concern with zero live readers
on that path — exactly the "seam everywhere on principle" noise dimension 6
exists to prevent, just showing up on dimension 4 instead.

**Fix:** `application` is now optional overall, required only under
`transport: 'broker'` (the path that actually consumes it —
`BrokerDomainEventEmitter` already names it in every error it throws).
`forRoot()` with no argument at all is the normal call again for in-process,
restoring the original "sensible default, no config needed" promise. Under
`in-process`, `APPLICATION_ID` is bound only if `application` is supplied
(opt-in, for a future cross-cutting consumer like `audit-logging`); if
omitted, the token simply isn't provided rather than resolving to `undefined`.

Updated: `domain-events.module.ts`, `tokens.ts`, `domain-events/README.md`,
`domain-events.module.spec.ts` (new tests for the opt-in/required-under-broker
behavior), `audit-logging.integration.spec.ts` and its README (both reverted
to the plain `forRoot()` call), and the two cross-module doc comments
(`notification.module.ts`, `background-jobs.module.ts`) that had cited
`domain-events`' `application` as an example of "no sensible default" — no
longer true. `MODULE-STANDARD.md` dimension 4 gained a line naming this
mistake explicitly, so it isn't repeated on a future module.

165/165 tests pass; typecheck clean.
