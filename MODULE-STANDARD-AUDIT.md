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

---

## 2026-09-04 — `domain-events` module-by-module review (in progress)

Per the review protocol agreed this session: modules are now reviewed one at a
time; fixes land only in the module under review; anything implying a
retrofit elsewhere is flagged here, not acted on until that module comes up.

**Finding — listener-side portability gap, real and currently undocumented as
such.** The producer side (`DomainEventEmitter`) is genuinely transport-agnostic;
the listener side (`@OnEvent()`/`@OnCriticalEvent()`) is not, and cannot be
made so with a facade decorator without hiding real behavioral differences
(no transactional rollback across a broker, at-least-once redelivery,
ack/offset semantics). **Status: documented in `domain-events/README.md`** —
"Keep the decorated method a thin dispatcher" (new subsection) gives the one
actionable mitigation available today (decorated methods stay thin, real
logic lives in a plain function/method), and the Model 2 "Subscription model"
bullet now names the three concrete guarantees that change, instead of
reading as a wiring-only concern. No new code — decision was explicitly not
to build a fake-portable decorator, consistent with dimension 6.

**Flagged for retrofit when reached:** `audit-logging`'s `AuditListener`
worked example is cited by name in the new domain-events guidance as the
existing precedent for the thin-dispatcher shape (its `handle()` method
already just calls `persistAuditRecord()`). No change needed to
`audit-logging` itself — it already does the right thing — but when
`audit-logging`'s own review comes up, cross-check that its README explicitly
names itself as the reference example, for discoverability in both
directions.

**Finding — `tenantId` on events: explicit field vs. ambient context, and a
second flagged item for `audit-logging`.** Clarified that a listener needing
tenant identity reads it off the concrete event's own field (never derives it
from `AsyncLocalStorage`-style ambient context) — a single execution can span
multiple tenants (see `background-jobs`' admin-scoped batch loop), and ambient
context can't survive a broker process boundary anyway. **Status: documented**
in `domain-events/README.md`'s tenantId note, with a worked example showing
`event.tenantId` flowing straight into `NotificationRequest.tenantId`.

**Flagged for retrofit when reached:** while explaining why tenant identity
must be explicit rather than ambient, it became clear `audit-logging`'s own
correlation-id mechanism has the identical latent problem — `AsyncLocalStorage`
context works today only because in-process dispatch keeps producer and
listener on one unbroken call chain, and that stops being true under a broker
transport, for the same reason ambient tenant context would break. No change
made (this is `audit-logging`'s own module, out of scope for the current
review) — when `audit-logging` comes up, its Model 2 section should name this
explicitly, the same way `domain-events`' own "Subscription model" bullet now
does for listener redelivery/ack semantics.

**Finding — failure observability was silently asymmetric, and two paths were
genuinely untraceable.** Best-effort (`@OnEvent()`) failures were already
logged automatically by NestJS's own loader; critical (`@OnCriticalEvent()`)
failures were not — logging depended entirely on unenforced producer
discipline, meaning a critical listener could fail with zero trace anywhere,
backwards from what "critical" should guarantee. Two points inside `emit()`
(an async rejection, and a synchronous throw from `emitAsync()` itself) were
also fully silent, including the exact mismatched-pairing bug the README's own
pairing table already named as a gotcha. **Status: fixed** —
`InProcessDomainEventEmitter.emitCritical()` now logs before rethrowing
(producer's rollback-or-swallow decision unchanged); both `emit()` catch
points now log instead of discarding. Event payloads are included via
`JSON.stringify` (already guaranteed serializable by contract), so the failing
record's own identifying fields appear in the log. 3 new tests
(`in-process-domain-event-emitter.service.spec.ts`, 7→10), 170/170 total pass,
typecheck clean. A structured, queryable delivery-outcome record (a
`JobRunRecorder`-equivalent for events) was deliberately *not* built —
documented as "Not built" prose in the README instead, no concrete signal for
it yet.

**Follow-up — clarified how "logged" becomes "notified."** README initially
implied wiring an observability tool was zero-code; verified against current
Sentry docs and corrected — NestJS's `Logger.error()` isn't auto-captured by
default instrumentation (only genuinely unhandled exceptions are), so a small
one-time custom `LoggerService` (`app.useLogger(...)`, ~10–15 lines) is the
actual mechanism. Also compared Sentry vs. Datadog concretely (free tier
reality, pricing model) and recommended Sentry for this stage. Both corrected
in `domain-events/README.md`'s "The practical path" section.
