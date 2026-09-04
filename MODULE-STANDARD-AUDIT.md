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

`domain-events` review closed here — no open items.

---

## 2026-09-04 — `authorization` module-by-module review (in progress)

**Finding — dimensions 7 and 8 conflated two different questions each, and
`authorization`'s Audit 1 scoring (7: N/A, 8: Pass) obscured the distinction
rather than being wrong outright.**

- **Dimension 7 (persistence):** Audit 1's flat "N/A" is accurate for what
  exists today (`StaticRoleMapAuthorizer` touches no database at all) but
  reads the same as a *permanent* N/A (like `applicationId`'s), when it isn't
  — `PermissionTableAuthorizer` will need real persistence once built, and
  dimension 7's rule (schema shareable, instance/connection consumer-owned)
  already applies to that future design, documented in the README's Model 2
  section. **Status: standard clarified** — `MODULE-STANDARD.md` dimension 7
  now distinguishes permanent N/A from "N/A today, rule already specified for
  later," so a future audit states which.
- **Dimension 8 (UI):** Audit 1's flat "Pass" was scored only against the
  end-user hide/show/disable contract (`computeSessionSnapshot`/
  `computeActionAvailability` — genuinely a full Pass), without separately
  scoring the *administration* UI (role/permission management for Model 2) —
  a materially thinner, one-paragraph sketch in the README's "Administration"
  section, appropriately light given it's downstream of an unbuilt Model 2,
  but not the same thing as the end-user contract. **Status: standard
  clarified** — dimension 8 now explicitly splits into "end-user UI contract"
  and "administration UI," scored separately; a module can Pass one and be
  a lighter sketch on the other without that being conflated into one verdict.

**Decision: `authorization/README.md`'s admin-UI paragraph stays as-is** —
expanding it into a full deferred-design sketch now (matching
`background-jobs`'/`audit-logging`'s treatment of their own not-built pieces)
would be designing a management surface for an authorizer that doesn't exist
yet, further ahead than dimension 6 already asks of every other module's
Model 2. Revisit if `PermissionTableAuthorizer` itself gets built first.

No code changed — `MODULE-STANDARD.md` only. 170/170 tests unaffected.

`authorization` review closed here — no open items.

---

## 2026-09-05 — `notification` module-by-module review (in progress)

**Finding — the documented "override the binding in your own module" escape
hatch was subtly broken, and this was more serious than a documentation gap.**
`NOTIFICATION_CHANNEL_CONFIG`/`EMAIL_TEMPLATE_REPOSITORY`/
`SMS_TEMPLATE_REPOSITORY`/`USER_CONTACT_RESOLVER` are never exported from
`NotificationModule` (only `NOTIFIER` is), and `Notifier` is constructed
inside `NotificationModule`'s own DI scope — NestJS provider registries are
per-module, so a same-named token bound in a separate consumer module never
reaches the `Notifier` instance `forRoot()` already built. The one existing
test exercising an "override" (`.overrideProvider(USER_CONTACT_RESOLVER)`)
passed only because that's `@nestjs/testing`-only tooling, not something a
real `AppModule` can do — masking that the documented production path didn't
actually work as written.

**Status: fixed.** `NotificationModuleConfig` gained four independent override
tokens (`channelConfigToken`, `emailTemplateRepositoryToken`,
`smsTemplateRepositoryToken`, `userContactResolverToken`) + `imports` —
mirroring `background-jobs`' `sqlExecutorToken` pattern, deliberately **not**
a single `model` enum the way `authorization`/`domain-events` have, since
notification has four independently-swappable pieces and a real deployment is
far more likely to swap one than all four atomically. `channels`/
`emailTemplates`/`smsTemplates` became optional, each required only when its
corresponding token is absent (mirrors `AuthorizationModule.forRoot()`'s own
runtime-checked requiredness for `personaActions`). 9 new tests in
`notification.module.spec.ts` (real DI, not `.overrideProvider()`) proving
each token swap, a partial swap (the realistic case — one piece overridden,
others still static), and the three missing-data throw paths. README updated:
new "Swapping one piece for a database-backed implementation" section
explaining why this had to be a `forRoot()` option (the per-module DI-scoping
reason above, spelled out); the channel-config worked example's binding
instructions corrected; two previously-missing worked examples added
(`NotificationTemplateRepository`, `UserContactResolver`) — closing the
uneven-documentation finding from the previous session too. 177/177 tests
pass, typecheck clean.

**Finding — `applicationId` as a passive schema column vs. an active query
parameter are different costs, and conflating them was too coarse.** Raised as
"what if the same `notificationType` exists for two different applications
under a unified database" — correctly identified as a non-issue under this
repo's actual architecture (per-app databases, a unified database already
ruled out for the same reasons as the earlier centralized-service decision).
But a real, distinct, low-cost practice survived that framing: a
database-backed reference schema should still stamp a passive `application_id`
column at write time (a constant or `DEFAULT`, never queried), because it's
free before the table exists and a genuine backfill migration after. **Status:
documented** — `notification/README.md`'s `applicationId` note and both
worked examples (`DatabaseNotificationChannelConfig`,
`DatabaseNotificationTemplateRepository`) now describe this precisely,
explicit that it's never added to `channelsFor()`/`templateFor()`'s actual
signature (that would repeat the `domain-events` mistake). Generalized into
`MODULE-STANDARD.md` dimension 4 as a standing distinction — applies to any
future module's reference schema (`authorization`'s eventual roles table,
`idempotency-key`'s table) — not notification-specific. No code changed
(schema/query examples are prose in the README, not shipped classes); 177/177
unaffected.

**Correction — a follow-up request to make `applicationId` a real
`NotificationModuleConfig` field was implemented, then caught broken by a real
test, then fixed properly.** The first attempt mirrored `domain-events`'
`APPLICATION_ID` shape (optional, bound only if given, exported) — but
`domain-events`' consumers (`audit-logging`) *import* `DomainEventsModule`
(downstream), while `NotificationChannelConfig`'s override classes are
constructed in a module `NotificationModule.forRoot()` merely imports *from*
(`channelConfigToken`/`imports` — upstream). A token bound inside `forRoot()`
is invisible in that direction; NestJS provider registries are per-module. A
throwaway `Test.createTestingModule()` check (this repo's own standing
discipline — verify with a real container, not just typecheck) reproduced
NestJS's own dependency-resolution error immediately, confirming the field as
built could never deliver its value to where it was meant to go. **Status:
reverted and fixed properly** — `applicationId` removed from
`NotificationModuleConfig`, `NOTIFICATION_APPLICATION_ID` kept as an exported
*name only* (no `forRoot()` binding), with `tokens.ts` and the README's
worked examples corrected to show the actual working shape: the consumer's
own module provides `NOTIFICATION_APPLICATION_ID` directly, in the same scope
as the class that injects it. New test proves the corrected pattern actually
resolves (real DI, not a mock). 178/178 pass, typecheck clean.

**Further correction — `NOTIFICATION_APPLICATION_ID` itself was removed.**
Once `forRoot()` couldn't bind it, the token's only remaining justification
was "a shared name to import" — but every *other* override token in this
module's worked examples (`DATABASE_CHANNEL_CONFIG`,
`DATABASE_EMAIL_TEMPLATES`, `DATABASE_SMS_TEMPLATES`, `DRIZZLE_USER_RESOLVER`)
is declared inline in the consumer's own example code, never exported from
`ascendra-commons/notification` — confirmed by checking the README directly.
More decisively: every *other* real token in `tokens.ts` exists because a
piece of shipped code injects it by that name (`Notifier` injects
`NOTIFICATION_CHANNEL_CONFIG`, the senders inject `USER_CONTACT_RESOLVER`);
`NOTIFICATION_APPLICATION_ID` was the only token with no shipped injector at
all — an exported-but-functionally-inert symbol carries the same
"looks-wired-but-isn't" risk the `applicationId` field itself just
demonstrated, just smaller. **Status: removed** — `tokens.ts` and `index.ts`
reverted to their pre-this-thread state; the worked examples and the test now
declare their own local `APPLICATION_ID` symbol, consistent with every other
override token's documented pattern. 178/178 pass, typecheck clean.
