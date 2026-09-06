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

**Correction to this entry, made while closing the session out:** this
originally said "no open items," which was wrong — the "don't hand-edit
`PermissionTableAuthorizer`" correction had been proposed twice earlier in
the `authorization` review (once when the stub was first built, once
mid-session) and never actually applied to `authorization/README.md`. Applied
now: a new note in the Model 2 section states the stub is never hand-edited
(same treatment as `BrokerDomainEventEmitter`), and shows the real,
self-contained `AuthorizationApiModule` shape — which, unlike `notification`'s
override tokens, needs no cross-module DI-scoping trick at all, since it
never relies on `forRoot()`'s own wiring.

`authorization` review closed here — no open items, this time genuinely.

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

`notification` review closed here — no open items.

---

## 2026-09-05 — `audit-logging` module-by-module review (in progress)

Two items were carried forward from the `domain-events` review specifically
for this module's turn (see that section above). Addressed first, before the
rest of this module's own review, per protocol.

**Finding 1 — the `AuditListener` worked example wasn't named as the
reference example it already is.** `domain-events`' README cites
`AuditListener.handle()` by name as the worked example of "keep the decorated
method a thin dispatcher" — `handle()` already does nothing but call the
plain `persistAuditRecord()`, so no behavior changed. But the citation only
ran one direction: `audit-logging/README.md` never said, at the worked
example itself, that it *is* that reference example. **Status: fixed** — a
note now sits directly under the worked example in `audit-logging/README.md`
pointing back to `domain-events`' "Keep the decorated method a thin
dispatcher" section by name, so the connection is discoverable from either
module's README. Docs only, no code changed.

**Finding 2 — correlation id has the same ambient-context-can't-cross-a-
process-boundary problem already reasoned through for `tenantId` in
`domain-events`, and it wasn't named.** `getCurrentCorrelationId()` works
today only because `domain-events`' current in-process dispatch keeps the
HTTP request (or job run) and the listener on one unbroken async call chain —
`AsyncLocalStorage` context doesn't survive a process boundary, the identical
mechanism-level fact `domain-events`' README already uses to explain why
`tenantId` must be an explicit field, never ambient. Unlike `tenantId`, the
fix isn't "make it an explicit field on the event" — a correlation id is a
cross-cutting execution identifier, not a fact about the entity being
audited, so it has no natural home on the event payload itself. The right fix
under a future broker transport is for the correlation id to travel in the
broker message's own envelope/headers, with the consumer calling
`runWithCorrelationId()` once per message to reestablish the context
explicitly — never left to `getCurrentCorrelationId()`'s ambient fallback,
which would silently mint an unrelated fresh id instead of erroring.
**Status: documented** — new paragraph in `audit-logging/README.md`'s Model 2
section, naming the problem, why the `tenantId` fix doesn't transfer, and the
actual fix shape. Not built — no broker transport exists yet on either
module's side. No code changed.

56/56 tests unaffected (doc-only changes); typecheck clean.

Rest of `audit-logging`'s own review (all 11 dimensions) surfaced three
further discussion points, resolved after a `notification` feature request
was handled mid-session (see the entry below) and the review resumed:

**Finding 3 — no worked persistence schema, unlike `notification`/`authorization`.**
`audit-logging` shipped `AuditEventRepository` with no example table at all,
despite being the one module already flagged (Finding 3, Audit 1) as the
plausible near-term case for `applicationId`'s passive-column pattern — there
was nothing for that guidance to land on. **Status: fixed** — new "A worked
schema example" section under `AuditEventRepository`, with a Drizzle-shaped
table (columns mapped directly off `AuditEvent`), two indexes justified by
name against the already-documented, not-yet-built `AuditQuery` shape (so
they're not speculative), and the `application_id`-stamped-on-insert
worked example wired to the already-available `APPLICATION_ID` token from
`domain-events`. Docs only, no interface change.

**Finding 4 — UI dimension scoring predates the end-user/admin split.**
Audit 1 scored `audit-logging` "Pass (fixed)" on UI before that split existed
(introduced during `authorization`'s review). **Status: fixed** — the "Not
built: reading audit records" section now states explicitly: end-user
contract is N/A (an audit trail has no per-record show/hide concern reaching
a tenant's own user), and the section itself is the admin-UI sketch,
appropriately prose-only since it's downstream of an unbuilt query API — same
treatment as `authorization`'s own admin-UI paragraph.

**Finding 5 — `action` is verb-only, an undocumented deviation from dimension
9's `resource.verb` convention.** `entityType`+`action` together express a
resource+verb pair, but `action` alone (`'status_changed'`) doesn't follow the
dot-notation convention by itself — reasonable (repeating `entityType` inside
`action` would be pure duplication), but unstated, the same category of gap
`background-jobs` had for job names in Audit 1. **Status: fixed** — new
paragraph in the `AuditableDomainEvent` section explaining why the two-column
split is the honest shape here, distinguishing it from the event *names*
raised to trigger auditing (which do follow dot-notation).

20/20 tests unaffected (all three fixes are docs-only); typecheck clean.

`audit-logging` review closed here — no open items.

### Summary table update

| Module | 7 Persist | 8 UI | 9 Naming |
|---|---|---|---|
| `audit-logging` | Pass (worked schema example added) | Pass (end-user N/A, admin sketch, both stated explicitly) | Pass (verb-only `action` explained) |

---

## 2026-09-05 — `notification` mid-review feature request: per-tenant provider credentials

Not part of the module-by-module review sequence — the user paused
`audit-logging`'s review to request a real feature in `notification`, which
was already closed. Recorded here since it changes that module's shape and
has direct dimension implications; `audit-logging`'s review resumes after.

**Request:** `EmailNotificationSender`/`SMSNotificationSender`/
`WhatsappNotificationSender` only ever logged the rendered message — there was
no seam for the real per-tenant delivery-provider credentials (API key,
sender address/number) a real deployment needs, sourced either statically or
from a database, keyed by `tenantId`. Clarified scope with the user first
(config-plumbing only, not a real provider SDK call; provider-agnostic field
names, not a specific vendor's shape) — both confirmed.

**Built**, following this module's own established shape (one generic
interface reused per channel via a type parameter, the same pattern
`NotificationTemplateRepository` already uses for email/SMS):

- `EmailProviderConfig`/`SmsProviderConfig`/`WhatsappProviderConfig` — new,
  provider-agnostic credential types (`notification-provider-config.ts`).
- `ProviderConfigResolver<TConfig>` — new interface (`configFor(tenantId)`),
  and `StaticProviderConfigResolver<TConfig>` — the Model 1 implementation.
  **Notable design point:** this is the one piece in the module whose Model 1
  implementation genuinely branches on `tenantId`, unlike
  `StaticNotificationChannelConfig`/`StaticNotificationTemplateRepository`
  (which ignore it by design — see Audit 1). Provider credentials are the
  opposite case: "one tenant, one provider account" is the normal shape from
  day one, not an eventual scaling signal — matching dimension 5's own
  standard, just landing differently per-module depending on what the module
  actually models. A `null` tenantId resolves to `null` (fails closed), not a
  deployment-wide default — a deliberate asymmetry from the channel-config/
  template DB examples' tenant-row-then-null-row fallback, documented in the
  README since it's the more surprising choice.
- Three new tokens per channel (`EMAIL_PROVIDER_CONFIG`/`_DATA`, same for
  SMS/WhatsApp), and three new `forRoot()` fields
  (`emailProviderConfigs`/`smsProviderConfigs`/`whatsappProviderConfigs`) each
  with a matching override token (`emailProviderConfigToken`/etc.) — same
  required-unless-token-given discipline every other piece in this module
  already follows (dimension 3), extending "four independently swappable
  pieces" (Audit 1 / the earlier `notification` review) to seven. All three
  senders now inject their channel's `ProviderConfigResolver` and fail with a
  new `'no_provider_config'` reason (checked after address resolution, before
  template lookup — cheapest short-circuit first) when nothing is registered
  for the request's tenantId. `WhatsappNotificationSender` gained its first
  constructor dependency; it remains a template/delivery stub otherwise.
- README: new "`ProviderConfigResolver`" pieces section, a new "Going to a
  database-backed provider config" worked example (noting the no-fallback
  asymmetry above), the `forRoot()` worked example and "Swapping one piece..."
  section updated to seven pieces, and "What's not built yet" narrowed to
  "no real provider HTTP call" now that the credentials seam itself exists.

**Verification, not just typecheck:** every `NotificationModule.forRoot()`
call site in `notification.module.spec.ts` needed the three new required
fields (or a token) added — a real, if mechanical, confirmation that the new
fields are actually required, the same way the repo's standing
`Test.createTestingModule()` discipline is meant to catch. New tests: real DI
proof of `emailProviderConfigToken`'s override path (not
`.overrideProvider()`), the three new `requireData` throw paths, and a
fails-closed case for an unregistered tenant. 189/189 tests pass (up from
178), typecheck clean.

`audit-logging`'s review resumed after this and closed with Findings 3–5,
recorded above under its own section rather than repeated here.

---

## 2026-09-05 — `audit-logging` redesign: explicit `AuditRecordRaised`, listener shipped

A real architectural question, not a review finding: the user asked how a
consuming application (`ascendra-pay-api`) actually distinguishes "this is an
audit event" from an ordinary domain event, given `AuditableDomainEvent` was
just a TypeScript interface with no runtime tag. Answering it surfaced a real
gap — "is this event audited" was decided by two separately-maintained facts
agreeing by convention, with nothing enforcing they did: the event class
implementing `toAuditRecord()`, and the consumer-authored `AuditListener`
separately subscribing, by string name, to that event's own name. Missing the
second one meant a `toAuditRecord()`-implementing event silently wasn't
audited — no error anywhere, since `EventEmitter2` dispatch is by string name
with no compile-time link back to which classes implement which interface.

**The user proposed the fix themselves:** have the producer raise a *separate,
dedicated* audit event explicitly, at the point where it already has the
old/new values in scope, rather than having one event class serve double duty
for both general listeners and auditing. Confirmed and extended one step
further: since the dedicated audit event's name doesn't need to vary per
business event (unlike today's per-event-name `@OnCriticalEvent()` list), it
can be **one single, fixed, library-defined name** — which removes the reason
`AuditListener` couldn't be shipped by this library in the first place (the
original design's stated reason: "which event names get audited is
project-specific"). Once the name isn't project-specific, neither is the
listener.

**Built:**
- `AuditableDomainEvent` interface **removed**, replaced by a concrete class
  `AuditRecordRaised` (`audit-record-raised.ts`) — already shaped like
  `AuditEventInput` (minus `correlationId`), so no `toAuditRecord()` mapping
  step exists anymore.
- `AUDIT_EVENT_NAME` — new, one fixed exported string constant
  (`'audit.record_raised'`) every `AuditRecordRaised` is emitted under.
- `AuditListener` (`audit-listener.ts`) — **now shipped by this library**,
  registered as one of `AuditLoggingModule.forRoot()`'s own providers. The
  consumer writes no listener at all anymore; auditing is done entirely from
  the producer side by constructing and emitting `AuditRecordRaised`.
- `persistAuditRecord()` simplified — takes `AuditRecordRaised` directly, no
  mapping call.
- README rewritten throughout: `AuditRecordRaised` piece (with the coupling
  problem and its fix spelled out), `AuditListener` piece, "Consuming this
  module" (no listener to write), the worked example (raising the audit event
  explicitly alongside an optional lean business event), Model 1's shipped
  list, and Model 2's opening paragraph (growth = more call sites raising the
  event, no second file to keep in sync). `domain-events/README.md`'s two
  stale cross-references to `AuditableDomainEvent.toAuditRecord()` and
  "`audit-logging`'s own worked example" were also corrected (the citation of
  `AuditListener.handle()` as the thin-dispatcher reference example still
  holds — it's shipped code now, not a worked example, and the pattern is
  true *by construction* rather than by discipline, since one fixed event
  name gives it exactly one thing to do).

**Verified, not just typecheck — the actual claim this redesign depends on:**
whether a provider declared *inside* `AuditLoggingModule.forRoot()`'s own
dynamic-module `providers` array (rather than the root testing module, as the
prior consumer-authored-listener design always did) is still discovered by
NestJS's `@OnCriticalEvent()` `EventSubscribersLoader`. Reasoning alone was
wrong twice already this session on claims of this shape — this one was
checked with a real `Test.createTestingModule()` + `emitCritical()` round
trip in `audit-logging.integration.spec.ts` before it was written into the
README. It holds: `EventSubscribersLoader` scans the whole module graph, not
just root-level providers.

New/changed specs: `audit-record-raised` covered via `persist-audit-record.spec.ts`
and `audit-listener.spec.ts` (new); `audit-logging.module.spec.ts` narrowed to
what it can actually prove (repository aliasing, `AuditListener` resolvable)
now that end-to-end discovery lives in the integration spec;
`audit-logging.integration.spec.ts` rewritten around `AuditRecordRaised`/
`AUDIT_EVENT_NAME` directly, with no `ConsumerAuditListener` left to write.
193/193 tests pass (up from 189), typecheck clean.

This simplifies the module in real terms, not just on paper: one fewer
exported interface, one fewer thing for a consumer to write, and one fewer
place ("did I remember to subscribe this event name") for the audit
guarantee to silently lapse.

**Follow-up, same day — a second, real redundancy the redesign above left
behind.** The user asked, correctly: with `AuditableDomainEvent` gone, what is
`AuditEvent` actually for now, and should `AuditEventInput` derive from
`AuditRecordRaised` or from `AuditEvent`? Checked against the real code, not
just reasoned about: `AuditEvent`'s 9 non-`id` fields were hand-declared a
*second* time in `audit-event.interface.ts`, identically to
`AuditRecordRaised`'s constructor fields — and `AuditEvent` itself (the `id`-
bearing shape) had zero real shipped consumers left, referenced only in
README prose for the not-yet-built `find()`/`AuditQuery` design.
**Status: fixed** — flipped the derivation direction: `AuditEventInput` is now
`Pick<AuditRecordRaised, ...> & { correlationId: string }`, and
`AuditEvent extends AuditEventInput` adds only `id`. `AuditRecordRaised` (the
actively-used, canonical class) is now the single hand-declared source of
truth for the field list; the persistence-shape types derive from it instead
of duplicating it, so the two can't drift apart. `AuditEvent` itself is kept
(not removed) — it's a free, zero-runtime-footprint type, already load-bearing
for the worked schema example and the deferred `find()` design, not the kind
of stub/seam dimension 6 warns against. README's `AuditEventRepository`
section updated to describe the new derivation. 24/24 audit-logging tests
(193/193 overall) still pass, typecheck clean — the `Pick<>` against a class's
instance shape resolves exactly as expected.

**Follow-up, same day — dimension 8's administration-UI side, spelled out
concretely.** The user asked whether a UI is required and, if so, what API
and web pieces it would need. Answer: not required now — same "documented,
not built" treatment as everything else downstream of `find()` not existing
yet — but the concrete shape is worth having on record given `audit-logging`
is already the module flagged with the most plausible near-term signal.
**Status: documented** — new paragraph in the "Not built: reading audit
records" section naming the two pieces neither of which `ascendra-commons`
itself would ship (same reasoning as `authorization`'s own admin UI staying
backend-pattern-only until `ascendra-commons-ui` exists): an API module
(one `can()`-gated endpoint, e.g. `'audit.view'`, taking `AuditQuery` and
returning `AuditQueryResult` unchanged) and a web module (admin-only route,
filter form, cursor-paginated table, nav entry hidden via the same
`computeActionAvailability`-style gate). No code — prose only, consistent
with dimension 6. 24/24 audit-logging tests unaffected, typecheck clean.

`audit-logging` review remains closed — this is documentation depth added on
request, not a reopened finding.

---

## 2026-09-06 — `audit-logging`: reference Postgres/Drizzle persistence adapter

Not a reopened review finding — a deliberate scope addition the user asked for
after walking through exactly what a consuming vertical has to write to stand
the module up. The conclusion of the 2026-09-05 review (Finding 3: ship a
*worked schema example* in the README, consumer owns the implementation) was
correct as the minimum, but left `audit-logging` shipping *less* than its
siblings: `idempotency-key` ships `PostgresIdempotencyStore` and
`background-jobs` ships `PostgresAdvisoryLock`, both concrete implementations of
their port against a minimal `SqlExecutor` — because the statement is
100%-library-owned and generic. An audit `INSERT` is exactly that shape (one
flat insert, every column off `AuditEvent`, zero project-specific logic), so
the same treatment applies. Without it, `ascendra-pay` and a future
`ascendra-erp` would each hand-write the identical schema + migration + Drizzle
mapping + repository — the per-consumer drift `MODULE-STANDARD.md` §7 accepts as
a cost, incurred here for no reason.

**Built** — new `audit-logging/adapters/postgres-drizzle/` folder (a
sub-folder, so a second adapter for a different stack slots in beside it
without touching anything):

- `audit-event.schema.ts` — Drizzle `pgTable` for `commons_audit_event`, the source of
  truth for the reference schema. Columns map 1:1 to `AuditEvent`, plus a
  passive `application` column (dimension 4 — stamped on insert, never queried).
  The two indexes from the earlier worked example carried over, still justified
  by the not-yet-built `AuditQuery`.
- `audit-event.migration.sql` — the same table as hand-written DDL. **Note:
  this is the first `.sql` file in the repo.** Deliberate: the module standard
  says the DB instance and migration *execution* stay consumer-owned (still
  true — the consumer copies this into its own migration tooling or exports the
  `pgTable` for `drizzle-kit`), but shipping the canonical DDL *text* means
  every vertical's `commons_audit_event` is byte-identical instead of independently
  hand-rolled. `idempotency-key` does the same thing in a doc-comment; this is
  that, in a file.
- `postgres-audit-event.repository.ts` — `PostgresAuditEventRepository`, one
  parameterised `INSERT` via `drizzle-orm`'s `sql` tag against the adapter's
  own `SqlExecutor` (copied from `background-jobs`/`idempotency-key`, not
  imported — keeps the folder independently copyable). `application` stamped
  from an injected string.
- `postgres-audit-persistence.module.ts` — `PostgresAuditPersistenceModule.forRoot({ sqlExecutorToken, application, imports })`,
  exports the repo as `POSTGRES_AUDIT_EVENT_REPOSITORY`.
- `sql-executor.ts`, `tokens.ts`, `index.ts`, `README.md`, two specs.

**The module core is unchanged.** `AuditLoggingModule.forRoot()` still takes
`auditEventRepositoryToken` + `imports` and nothing else — decided with the
user rather than growing a second `sqlExecutorToken` mode onto it. A
Postgres/Drizzle consumer passes `POSTGRES_AUDIT_EVENT_REPOSITORY` and puts
`PostgresAuditPersistenceModule.forRoot(...)` in the same `imports`; a consumer
on any other stack passes its own token exactly as before. The reference
adapter is opt-in via subpath import, never re-exported from
`audit-logging/index.ts`, so a consumer that doesn't want `drizzle-orm/pg-core`
pulled in doesn't get it.

**`application` naming.** Settled with the user after a first pass that had the
`forRoot` field as `application` but the column/property as `applicationId` /
`application_id` (mirroring `domain-events`' split of `application` field →
`DOMAIN_EVENTS_APPLICATION_ID` token). The user preferred one word everywhere: the `forRoot`
field, the injected constructor value, and the DB column are all `application`.
The one place a suffix stays is the DI token — `AUDIT_APPLICATION_ID`,
module-prefixed so it can't collide with another module's application token
(the same per-module-prefix convention the rest of the library uses). Supplied
to the adapter as a plain value, not `domain-events`'
`DOMAIN_EVENTS_APPLICATION_ID` token — revises the earlier README note ("no new
token, comes free from `domain-events`"), so the adapter works whether or not
the consumer passes `application` to `DomainEventsModule.forRoot()`.

### Dimension re-scoring

| Dimension | Was | Now |
|---|---|---|
| 4 — passive metadata | Pass (documented in worked example) | Pass (`application` now a real column in shipped `pgTable` + DDL, stamped by `PostgresAuditEventRepository`) |
| 7 — persistence ownership | Pass (worked schema example) | Pass (reference implementation shipped, matching `idempotency-key`/`background-jobs`; DB instance + migration execution still consumer-owned) |

README updated: "Persistence — the port here, a reference implementation
alongside it" replaces "A worked schema example"; Model 1 "What's shipped" and
"Consuming this module" updated. 205/205 tests pass (up from 193 — 12 new in
the adapter), typecheck clean.

---

## 2026-09-06 — `domain-events` re-review (triggered by the adapter work above)

The user asked for a consistency/correctness pass on `domain-events` while it
was fresh, plus a rename of its application token for prefix consistency with
the new `AUDIT_APPLICATION_ID`.

**Correctness — clean, nothing found.** `emit()`/`emitCritical()` semantics
are right and thoroughly tested (isolation between critical listeners, sync vs
async throws, the `@OnEvent()`-swallows-the-failure gotcha verified as a
passing test, the `{ global: false }` leak fix verified by a real container).
`assertDomainEventSerializable()` covers the cases that matter (circular refs,
`Map`/`Set`/typed arrays, methods, `NaN`/`Infinity`). The `@Inject(EventEmitter2)`
explicit-token workaround for esbuild metadata is correct and documented. The
logging added at every catch point is the right observability posture for a
module whose failure mode is "silently dropped".

**Gap 1 — `DOMAIN_EVENTS_APPLICATION_ID` was documented as consumer-injectable
but not exported from `index.ts`.** The README's "Consuming this module" import
block listed `APPLICATION_ID` from the barrel; the barrel only exported
`DOMAIN_EVENT_EMITTER`. A consumer following the README verbatim would hit a
compile error. **Status: fixed** — added to `index.ts`'s export.

**Gap 2 — the token's own doc comment and the README cited `audit-logging` as
the concrete in-process consumer that would `@Inject()` it.** After the adapter
work above, that's stale: `audit-logging`'s adapter deliberately takes
`application` through its own `forRoot()` and binds `AUDIT_APPLICATION_ID`,
precisely so it doesn't depend on the consumer opting into `domain-events`'
optional `application`. **Status: fixed** — `tokens.ts`, the README's
"Application identity" section, and `MODULE-STANDARD.md` dimension 4 now state
the actual rule: the shared token is for *opt-in* output-tagging; a module that
*always* needs the value binds its own module-scoped token. This also reconciles
dimension 4 with the 2026-09-05 `notification` finding (which removed its
exported token) — same conclusion, reached from opposite directions.

**Rename.** `APPLICATION_ID` → `DOMAIN_EVENTS_APPLICATION_ID` (Symbol description
too), module-prefixed to match `DOMAIN_EVENT_EMITTER` and `AUDIT_APPLICATION_ID`.
No functional change (Symbols never collided), pure clarity. All call sites,
specs, both READMEs, and both `MODULE-STANDARD*.md` files updated.

**Not changed — deliberate.** The listener side (`@OnEvent()`/`@OnCriticalEvent()`)
has no transport seam; this is extensively documented ("Keep the decorated
method a thin dispatcher") and correct to leave as a known Model-2 cost rather
than paper over with a false abstraction. `index.ts` also exports the concrete
emitter classes (`InProcessDomainEventEmitter`, `BrokerDomainEventEmitter`) —
consumers inject the token, not the class, but this matches the other modules'
barrels (`idempotency-key` exports `PostgresIdempotencyStore`) and is handy for
test overrides; left as is.

205/205 tests still pass (the rename adds none; `domain-events`' own 36 are
unaffected), typecheck clean.

---

## 2026-09-06 — `authorization` re-review

Re-verification pass at the user's request, alongside the `domain-events` one
above. The 2026-09-04 review closed clean; this pass checked correctness and
consistency against the standards as they stand now.

**Correctness — solid.** `StaticRoleMapAuthorizer` fails closed (unknown
persona → deny, `'*'` → allow-all, verified). `AuthorizationGuard` splits
401 (no actor) from 403 (actor, not permitted) correctly, uses explicit
`@Inject(Reflector)` / `@Inject(AUTHORIZER)` (the esbuild-metadata fix, matching
`domain-events`). `computeActionAvailability` checks permission before state so
a state check never leaks a record's state to someone who can't act on it —
tested. `PermissionTableAuthorizer` stub throws loudly, mirrors
`BrokerDomainEventEmitter`.

**Dimension 4 (`applicationId`) — permanent N/A, correct.** An authorization
decision never leaves the process; there is no shared destination to
disambiguate a producer for. Not "N/A for now" like `authorization`'s own
dimension 7 — this one never changes. README already states it.

**Gap 1 — `computeActionAvailability`'s `stateCheck` was sync-only,
inconsistent with the module's own async-from-the-start principle.** `can()` is
`Promise<boolean>` explicitly so Model 2 is a drop-in; `stateCheck` had no such
allowance, so a check needing a further lookup ("does this invoice have unpaid
children") couldn't be passed without hoisting the `await` to the call site —
which would lose the "only runs after the permission check passes" guarantee.
**Status: fixed** — signature widened to `() => StateValidity | Promise<StateValidity>`,
`computeActionAvailability` now `await`s it. Non-breaking (sync returns still
work). README + doc comment updated; two tests added (async check awaited;
async check never invoked when unpermitted).

**Gap 2 — `AuthorizationGuard` read `@RequiresAction()` off the handler only.**
A class-level `@RequiresAction()` (reasonable for a controller where every
route needs the same action) was silently ignored. **Status: fixed** —
`reflector.getAllAndOverride([getHandler(), getClass()])`, method-level
overriding class-level. Test added with a real class-decorated controller.

**Gap 3 — the guard is HTTP-only and didn't say so.** `switchToHttp()` — a
GraphQL/RPC transport would break. **Status: documented** — doc comment now
states it, and that the `Authorizer`/`can()` layer underneath is
transport-agnostic and reusable by a context-aware variant.

**Gap 4 — the guard was allow-by-default for undeclared endpoints.** It
returned `true` for any endpoint with no `@RequiresAction()`. As a global
`APP_GUARD` that meant a new state-changing endpoint shipped **open to
everyone** if the author forgot the decorator — a silent failure, exactly the
kind this module's guard-not-scattered-calls design exists to prevent, just one
level up. The user confirmed the risk and asked for deny-by-default plus an
explicit opt-out for genuinely public routes. **Status: fixed** —

- New `@NoActionRequired()` decorator (+ `NO_ACTION_REQUIRED_KEY`), method- or
  class-level. Says "this endpoint is intentionally not action-gated" — not
  "unauthenticated," which stays the consumer's auth guard's call.
- `AuthorizationGuard` now throws `AuthorizationNotDeclaredError` (a plain
  `Error` → 500, naming the `Controller.handler()`) when an endpoint declares
  neither decorator. Fails closed — the request never reaches the handler.
- Precedence: a method-level declaration (either kind) wins over a class-level
  one — resolved by checking the handler fully before falling back to the
  class, so `@NoActionRequired()` on a method inside a `@RequiresAction()`
  controller (and vice versa) does what it looks like it does.
- This is a **breaking behavior change** on re-copy (dimension 11): an existing
  app adding the global guard must annotate every non-actioned route or it 500s.
  Called out explicitly in the README's "Enforcement is a Guard" section with a
  controller-by-controller migration note (class-level `@NoActionRequired()`
  covers a read-only controller in one line). Acceptable because the module is
  v0.1.0 and the safe-by-default posture is the right one for a financial
  domain — but the audit records it as a real dimension-11 break, not a
  transparent change.

`AuthorizationNotDeclaredError`, `NoActionRequired`, `NO_ACTION_REQUIRED_KEY`
exported from the barrel. 10 guard tests (precedence matrix included) + 2
module-level tests through real reflection.

215/215 tests pass (up from 205 — 10 new in `authorization`), typecheck clean.

---

## 2026-09-06 — `authorization`: Model 2 built — Postgres/Drizzle adapter

Scoped decision-by-decision with the user (six core decisions + a walk through
each deferred item). The 2026-09-04 review left Model 2 as "seam in place,
authorizer not built"; this builds it, the same way the audit-logging adapter
was built — a self-contained `adapters/postgres-drizzle/` folder.

### Core model

- **Roles supersede persona.** Under Model 2 the DB authorizer resolves `can()`
  from `commons_authz_user_role → commons_authz_role → commons_authz_role_permission` (+ active
  delegations), never from `actor.persona` — which stays a coarse label.
  `seedRolesFromPersonaMap()` converts a Model 1 `personaActions` map into
  roles so the switch is behaviour-preserving. Model 1 ↔ Model 2 stays a
  wiring-time switch (`model:` string), one active at a time.
- **`commons_authz_role.grants_all boolean`** is the `'*'` wildcard — no magic row.
- **`authz_` table prefix** — `role` / `user_role` are names a vertical wants.
- **No `application` column** — role catalogs are project-specific; the
  cross-product-analytics case is too weak, and these tables are small enough
  that a later backfill is trivial (contrast audit-logging's adapter, where the
  huge table justified it).
- **`forRoot({ model: 'permission-table', authorizerToken, imports })`** — the
  `model` enum stays as the explicit switch; `authorizerToken` points at the
  adapter's `POSTGRES_PERMISSION_TABLE_AUTHORIZER` (or a custom `Authorizer`).
  No token → the throwing stub, unchanged.

### `Authorizer` gains an optional `allowedActions?`

`allowedActions(actor, candidates)` — resolves "which of these does the actor
hold" in one call. `computeSessionSnapshot` uses it when present
(`if (authorizer.allowedActions)`), so `/me` is one query instead of one
`can()` per action (an N+1 against a DB authorizer). Both shipped authorizers
implement it; the per-action loop stays as the fallback for a hand-written or
throwaway `can()`-only authorizer, and inline test doubles (`{ can: vi.fn() }`)
stay valid because the method is optional. Non-breaking.

*(First cut was a separate `BulkAuthorizer extends Authorizer` interface + an
`isBulkAuthorizer` type guard. The user pointed out that if every real
authorizer implements it, the separate interface earns nothing — collapsed to
one optional method on `Authorizer`.)*

### In v1

- **Minimal delegation** — `commons_authz_delegation` table, **snapshot** model
  (actions fixed at grant time; mandatory `expires_at` capped at
  `maxDelegationDays`, default 90; one-call revoke). Grant-time check uses the
  granter's **role** permissions only, so **chains are blocked** by
  construction. `DelegationService` ships `delegate` / `revokeDelegation` /
  `listDelegations`. Audit is the consumer's to wire from its controller — the
  service takes no dependency on `domain-events` / `audit-logging`.
- **Action catalog** — `commons_authz_action` (`name` PK + nullable `description`).
  `commons_authz_role_permission.action` is a FK (`ON DELETE RESTRICT`). `syncActions()`
  is insert-only — new keys get a null description, existing rows (incl.
  UI-entered descriptions) are never touched, nothing is deleted. Reversed the
  initial "defer" call at the user's request: descriptions need a home, and a
  nullable column filled in later via UI is it.
- **Per-request permission cache** — `AsyncLocalStorage` + one-line
  `AuthorizationCacheMiddleware`. Not Redis, not cross-request, not cross-node —
  built fresh per request, discarded at request end, so zero staleness and no
  invalidation problem. Degrades to no-cache if unwired. A node-level TTL memo
  (+ optional pub/sub) is documented as a later step gated on profiling.

### Deferred (documented in the adapter README)

Role hierarchy (`parent_id` + recursive query + cycle detection + inherited-cell
UI) · delegation advanced (live granter re-check, cascade-on-revoke, chains,
resource scoping, approvals) · resource-level grants (`can()` 3rd param +
`authz_resource_grant` + RLS-aware policies) · a role-management service (the
vertical writes role/assignment CRUD against the documented schema) · the admin
matrix UI (frontend / future `ascendra-commons-ui`) · node-level TTL memo.

### Dimension re-scoring

| Dimension | Was | Now |
|---|---|---|
| 6 — Model 1/Model 2 | Pass (M2 = prose + stub) | Pass (M2 built as an adapter; stub kept for "selected, not wired") |
| 7 — Persistence | N/A for now (M2 will need it) | Pass — adapter ships the `authz_*` schema + migration; DB instance + migration execution stay consumer-owned; role/assignment CRUD is the vertical's |
| 8 — Admin UI | Pass (prose sketch) | Pass (prose sketch, now in the adapter README with the definition/assignment split and matrix layout; UI still not shipped) |

**Core files changed:** `authorizer.ts` (optional `allowedActions?`,
`StaticRoleMapAuthorizer` implements it), `session-snapshot.ts` (uses it when present),
`authorization.module.ts` (`authorizerToken` + `imports`),
`permission-table-authorizer.ts` (trimmed to the stub), `index.ts`, README.

**New:** `authorization/adapters/postgres-drizzle/` — `schema.ts`,
`authorization.migration.sql`, `sql-executor.ts`, `sql-helpers.ts`, `tokens.ts`,
`permission-cache.ts`, `permission-loader.ts`,
`postgres-permission-table-authorizer.ts`, `delegation.service.ts`,
`sync-actions.ts`, `seed-roles-from-persona-map.ts`,
`postgres-authorization.module.ts`, `index.ts`, `README.md`, 6 spec files.

244/244 tests pass (up from 215 — 29 new), typecheck clean.

---

## 2026-09-06 — `notification`: consolidate the config surface

The user's finding, confirmed on review: the module had **4 single-method
config interfaces** (`NotificationChannelConfig`, `NotificationTemplateRepository`,
`ProviderConfigResolver<T>`, `UserContactResolver`) spread across **7 provider
slots**, driving **~14 `forRoot` fields**, **14 tokens**, and a **~130-line
`forRoot`** of seven near-identical `token ? bind-yours : build-static` blocks.

The stated justification — "seven independently swappable pieces, a deployment
swaps one not all seven" — doesn't hold: per-tenant routing, templates, and
credentials tend to arrive together (when a project goes seriously
multi-tenant), and the 2026-09-05 `applicationId` saga in this same file shows
the multi-token structure was itself a source of friction. Three of the four
interfaces are the same axis ("notification configuration, per type / channel /
tenant").

### Change

**One interface, one token.**

```typescript
interface NotificationConfig {
  channelsFor(notificationType, tenantId): Promise<NotificationChannel[]>;
  templateFor(channel, notificationType, tenantId): Promise<NotificationTemplate | null>;
  providerConfigFor(channel, tenantId): Promise<ProviderConfig | null>;
}
```

- `templateFor` / `providerConfigFor` gain a `channel` param — collapses the
  separate email/sms/whatsapp instances into one implementation.
- `ProviderConfig` unifies to `{ apiKey, from, fromName? }` — `from` replaces
  `fromAddress`/`fromNumber` (address-or-number). The one small semantic loss,
  worth dropping 3 near-identical types + 3 tokens.
- `StaticNotificationConfig` (built via `useValue` from an in-memory object,
  not `@Injectable`+`@Inject` — so it can be `extends`ed cleanly) keeps the
  existing asymmetry: ignores `tenantId` for routing/templates, honors it for
  credentials.

**`UserContactResolver` stays separate** — a different axis (recipient
resolution against the consumer's user table, not notification config). The
user identified this exception correctly.

**`forRoot` shrinks**: `model?` / `channels?` / `templates?` / `providerConfigs?` /
`configToken?` / `userContactResolverToken?` / `imports?` — 7 fields, 2 override
tokens, ~45-line `forRoot`. `templates` / `providerConfigs` became **optional**
(a missing entry is a graceful per-send failure, not a wiring error) — a
deliberate relaxation from the old all-seven-required. (`model` was added in a
follow-up — see the Dimension notes below.)

**Partial override preserved** — `StaticNotificationConfig` is exported; a
consumer wanting one method dynamic writes
`class C extends StaticNotificationConfig { async channelsFor(...) {...} }` and
binds it under `configToken`. Less work than the old per-piece grid.

### Deleted

`notification-channel-config.ts`, `notification-provider-config.ts` (+ their
specs) — folded into `notification-config.ts`. `NotificationTemplateRepository` /
`StaticNotificationTemplateRepository` removed from `notification-template.ts`
(which keeps `NotificationTemplate` + `renderTemplate`). 9 per-channel tokens
removed from `tokens.ts`.

### Not changed

`Notifier`, the three `NotificationSender`s (delivery mechanism, genuinely
per-channel), the `NOTIFICATION_CHANNEL_SENDERS` map. Same feature set — routing,
per-channel per-tenant templates, per-channel per-tenant credentials, null-user
default, `notify` / `notifyCritical`, all backstops. Nothing removed.

### Dimension notes

- **4 (`applicationId`)** — unchanged: still N/A, the "stamp a passive column
  in your own DB-backed class" guidance now points at `NotificationConfig`'s
  single worked example instead of two.
- **7 (persistence)** — unchanged: schema shareable, instance consumer-owned;
  the worked DB-backed example is now one class, not three.
- **3 (`forRoot` discipline)** — improved: 14 fields → 7, 14 tokens → 4.
- **5 (`tenantId`)** — unchanged, clarified. The user asked whether
  `StaticNotificationConfig` ignoring `tenantId` for `channelsFor`/`templateFor`
  (but honoring it for `providerConfigFor`) is a gap. Decision: **leave it** —
  static is deployment-wide for routing/templates by design; per-tenant routing
  or white-labeled content is the signal to go `model: 'database'` (whose
  DB-backed impl does tenant-specific-first fall-through). `providerConfigFor`
  is per-tenant even in Model 1 because "tenant brings own provider account" is
  day-one normal, not a divergence. Doc comments + README sharpened so the
  asymmetry reads as deliberate. No code change.
- **6 (Model 1/Model 2)** — `forRoot` now takes a **`model: 'static' | 'database'`**
  enum, matching `authorization`'s `model` and `domain-events`' `transport`.
  This **supersedes the 2026-09-05 decision** ("deliberately not a single
  `model` enum … four independently-swappable pieces"): with the four
  interfaces collapsed to one `NotificationConfig`, there is exactly one
  implementation chosen wholesale, so the enum is now honest and consistent.
  `'static'` (default) requires `channels`; `'database'` requires `configToken`
  — each throws a clear message naming the missing field.
  `userContactResolverToken` stays orthogonal to `model` (works with either).

README rewritten (pieces section, consuming, database-backed). 240/240 tests
pass (down from 244 — the 7 redundant per-token override tests collapse to 5),
typecheck clean.

---

## 2026-09-06 — `notification`: Model 2 built — Postgres/Drizzle adapter

Follows the consolidation above and the `audit-logging` / `authorization`
adapter pattern. `notification/adapters/postgres-drizzle/` — opt-in via subpath
import, never re-exported from `notification/index.ts`.

### Design (discussed decision-by-decision with the user)

- **3 tables**, `notification_` prefix, every row carrying `application`:
  - `commons_notification_channel_route` (application, notification_type, tenant_id nullable, channels[])
  - `commons_notification_template` (application, channel, notification_type, tenant_id nullable, subject, body, is_html)
  - `commons_notification_provider_credential` (application, channel, tenant_id NOT NULL, api_key, from, from_name)
- **Tenant-first fall-through** for routing + templates via
  `ORDER BY tenant_id IS NULL LIMIT 1` (`false` sorts first). Fixed a latent bug
  the old README example carried — `ORDER BY tenant_id DESC` puts NULLs *first*
  in Postgres, i.e. the wrong way.
- **`providerConfigFor` does not fall through** — a missing row is
  `no_provider_config`, never another tenant's account; `null` tenantId
  short-circuits with no query.
- **Credentials (`api_key`): plaintext column + strong guidance** (Option A of
  the three discussed). Encryption-at-rest is a deployment decision — the README
  points at Supabase Vault / pgcrypto / a decrypting view / column-level REVOKE.
  Option C (routing+templates from DB, credentials stay static via a
  `StaticNotificationConfig` subclass) is documented as the lighter path for a
  routing-only need.
- **TTL cache** — `ConfigCache`, per-process, default 30s, `cacheTtlSeconds: 0`
  disables. `Notifier` + senders read config on every send; a batch job would
  otherwise repeat identical queries. Time-bounded (not request-bounded like the
  authorization adapter's) because a batch job has no request. Bounded map
  (evicts expired, then oldest).
- **Seed helper** — `seedNotificationConfigFromData(db, application, data)`
  writes the static shape as `tenant_id NULL` deployment-default rows, so
  `model: 'static'` → `'database'` is behaviour-preserving; tenant override rows
  are added later through the vertical's own admin path.
- **`application` — active, not passive** (user's call, after discussion). Every
  table has an `application` column and every read filters `WHERE application = $1`,
  from `PostgresNotificationConfigModule.forRoot({ application })` (required).
  Constant within one app's own database → costs nothing there, but the tables
  stay correct if all Ascendra apps' notification config is ever consolidated
  into one shared database. Justified because notification *types* genuinely
  collide across products (`invoice.sent` in both pay and erp), unlike
  `authorization`'s role catalog which is project-specific (Decision 5 there:
  no column). This is the "one step further" case now written into
  `MODULE-STANDARD.md` dimension 4 — an active `application` filter that
  resolves to one value per deployment is not the `domain-events` mistake (the
  parameter has a reader).

### Wiring

```typescript
NotificationModule.forRoot({
  model: 'database',
  configToken: POSTGRES_NOTIFICATION_CONFIG,
  imports: [PostgresNotificationConfigModule.forRoot({
    sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule],
  })],
})
```

### Dimension notes

- **4 (`applicationId`)** — the core `NotificationConfig` interface stays free
  of it; the adapter carries it as an **active** filter (see above), and
  `MODULE-STANDARD.md` dimension 4 gained the "one step further" paragraph for
  cross-product-colliding rows.
- **6 (Model 1/Model 2)** — Model 2 is now built as an adapter, matching
  `audit-logging` / `authorization`. `model: 'database'` with no `configToken`
  throws at `forRoot` (there is no meaningful stub for notification config).
- **7 (persistence)** — Pass: adapter ships the `notification_*` schema +
  migration + seed; DB instance and migration execution stay consumer-owned;
  per-tenant override rows are the vertical's to write.

**New:** `notification/adapters/postgres-drizzle/` — `schema.ts`,
`notification-config.migration.sql`, `sql-executor.ts`, `sql-helpers.ts`,
`tokens.ts`, `config-cache.ts`, `postgres-notification-config.ts`,
`postgres-notification-config.module.ts`, `seed-from-static-data.ts`,
`index.ts`, `README.md`, 4 spec files. Main README's "Going database-backed"
section rewritten to point at the adapter.

259/259 tests pass (up from 240 — 19 new in the adapter), typecheck clean.

**Follow-up, same day — `application` made active.** The user flagged that the
adapter tables had no `application` column, so two products could define the
same `notificationType`. Discussed passive vs. active; the user chose active.
Added `application` to all three tables + unique constraints, `WHERE application = $1`
to all three reads, `forRoot({ application })` (required), and the seed helper's
signature. `MODULE-STANDARD.md` dimension 4 gained the "one step further"
paragraph distinguishing this (a filter with a reader, one value per
deployment) from the `domain-events` unread-required-field mistake. 259/259
tests pass (assertions added to existing adapter specs), typecheck clean.

**Follow-up, same day — `ProviderConfig` made opaque.** The user pointed out
that `{ apiKey, from, fromName? }` is a guess that doesn't fit every provider
(SES needs access key + secret + region; OAuth providers a token; Twilio a SID
+ auth token + number). Changed `ProviderConfig` to `Record<string, unknown>` —
an opaque JSON blob the library never reads inside; the consumer's real `send()`
interprets it. `commons_notification_provider_credential`'s `api_key`/`from`/`from_name`
columns collapse to one `config jsonb`. The stub senders stop logging the
provider config (it may hold secrets) — they log only the rendered message.
`Notifier` and `NotificationConfig` untouched; the seam is unchanged, just
honestly typed. 259/259 tests pass, typecheck clean.

---

## 2026-09-06 — `background-jobs`: robustness fixes + job-run observability

Triggered by a completeness review of the module with the user. Three parts.

### G1–G4 — review findings from the session

- **G2 — `release()` in `finally` could mask a job failure.** An unguarded
  rejecting `await` in `finally` replaces the error propagating from the `try`
  block, so a transient `pg_advisory_unlock` failure would hide a `findDueItems()`
  throw. Fixed: `release()` is `.catch`-guarded, a failed unlock is logged, never
  rethrown.
- **G3 — per-item failures were undiagnosable.** `logger.error(msg, err as Error)`
  passed an `Error` where a stack string belongs, and no item identity was
  logged. Added optional `ScheduledJob.describeItem?(item): string` (log-safe id,
  a throw is swallowed — it can never break a batch), and the runner now logs
  `failed on invoice a1b2` or `failed on item 2/3`, with `err.stack`.
- **G4 — the worked example shipped an at-least-once hole.** `emitCritical()` and
  `markRemindedToday()` are separate transactions, so a failure between them
  re-sends the reminder. README now threads a deterministic `reminderKey` and
  spells out the two ways to close it (downstream dedupe via `idempotency-key`,
  or a transactional outbox).
- **G1 — session-level advisory lock has connection affinity the pool doesn't
  give it.** `pg_try_advisory_lock` / `pg_advisory_unlock` through a `pg.Pool`
  can land on different connections; the unlock no-ops, the lock leaks on the
  acquiring connection until it idle-closes, and the job silently skips runs.
  Broken outright through a transaction-mode pooler. **The user chose "Option D"
  for now** (document + detect, not the lease-table rewrite): `release()` logs a
  WARN when `pg_advisory_unlock` reports the lock wasn't held; README requires
  `SQL_EXECUTOR` to be a **dedicated single connection**
  (`Pool({ max: 1, idleTimeoutMillis: 0 })`), never a transaction pooler; a
  "Accepted limitations" list was added to the Model 1 section (also covering
  the unbounded due-set, serial processing, poison-item forever-retry,
  `hashtext` 32-bit collision, bootstrap-runs-every-deploy). The lease-table fix
  (Option C) stays documented as the deferred robust answer, paired with the
  observability work below.

### Job-run observability — built (opt-in), with `application`

`IdempotentJobRunner` now assembles one `JobRunSummary` per execution that
acquired the lock (`jobName`, `trigger`, `startedAt`/`finishedAt`,
`outcome: 'completed' | 'job_failed'`, `itemsDue`/`itemsProcessed`/`itemsFailed`,
`failedItemRefs` capped at 50, `error?`) and hands it to a `JobRunRecorder` in
the `finally`, best-effort (guarded — a telemetry failure can never mask or
compound the real outcome, the opposite posture to `audit-logging`). A
lock-not-acquired return is not a run and is not recorded. `run()` gained an
optional `{ trigger }` (`'scheduled'` default / `'bootstrap'` / `'manual'`) —
the schedule wrapper knows why it fired, the runner doesn't.

- **Core** ships the `JobRunRecorder` port + `NoopJobRunRecorder` (the default
  binding). `BackgroundJobsModule.forRoot({ jobRunRecorderToken })` swaps in a
  real one; omitted → no-op, zero behaviour change.
- **`background-jobs/adapters/postgres-drizzle/`** (new, matching the
  `audit-logging` / `notification` / `authorization` adapter pattern):
  `job-run.schema.ts` + `job-run.migration.sql` (`commons_jobs_job_run` table),
  `postgres-job-run-recorder.ts` (one `INSERT`, `application` stamped, failed
  write logged and swallowed), `postgres-job-run-recorder.module.ts`,
  `job-run-pruner.job.ts` + `.module.ts` (reference `JobRunPrunerJob` — the
  module dogfooding its own `ScheduledJob` interface; `application`-scoped
  DELETE, `retentionDays` default 90), `sql-executor.ts` (duplicated),
  `tokens.ts`, `index.ts`, `README.md`, 3 spec files.
- **`application` — active, per the user's request**, same call as
  `notification`: every `commons_jobs_job_run` row carries it (from
  `PostgresJobRunRecorderModule.forRoot({ application })`), every read must
  filter by it, the pruner's DELETE is scoped to it. `commons_jobs_job_run` is the one
  `background-jobs` surface where multiple Ascendra apps' output could land in
  one shared operational database.
- **Missed-schedule detection is downstream, not built** — you cannot record a
  run that didn't happen; alert on "no `completed` run of job X in longer than
  its cadence." `trigger` distinguishes a normal fire from a bootstrap catch-up.
- **No read/query API, no watchdog, no UI contract** — the consumer's admin
  screen queries `commons_jobs_job_run` directly through the re-exported `jobRunTable`.

### Dimension notes

- **4 (`applicationId`)** — core stays N/A (a run never leaves its process).
  The adapter's `commons_jobs_job_run` carries an **active** `application` filter, exactly
  the `notification` "one step further" case already in `MODULE-STANDARD.md`
  dimension 4 (a filter with a reader, one value per deployment — not the
  `domain-events` mistake). Summary-table verdict unchanged (N/A tracks the
  core, as it does for `notification`).
- **6 (Model 1/Model 2)** — still Model 1. Observability is a Model 1 extension
  (was the "Not built" section, now built), not the Model 2 queue.
- **7 (persistence)** — still Pass. The advisory lock owns no DB; the new
  `commons_jobs_job_run` table is a shared *reference* schema + migration, DB instance and
  migration execution consumer-owned, matching every other adapter.

**Tests:** 287/287 pass (from 259 at the start of this session — 28 new across
the G2/G3/G4 + Option D fixes and the observability adapter; all in
`background-jobs`, which goes 10 → 38), typecheck clean.

**Follow-up, same day — on-demand job trigger (the admin "run now" / "retry"
hook).** Once observability gives an admin screen showing failed runs, the
natural next ask is a button to re-run one out of schedule. Built in the core
(stack-agnostic, no DB):

- `IdempotentJobRunner.run()` now returns `JobRunSummary | null` instead of
  `void` — `null` = lock not acquired; still **rejects** if `findDueItems()`
  threw (the `@Cron` contract is unchanged). Backward-compatible for callers
  that ignore the return.
- `ScheduledJobRegistry` — name → `ScheduledJob` instance, populated by
  `BackgroundJobsModule.forRoot({ jobs: [...] })` (explicit list, no
  `DiscoveryService`, matching the module's rejection of dynamic cron
  registration). Duplicate name → startup error (name is the lock key).
- `JobTrigger.trigger(name)` → discriminated result (`unknown_job` /
  `already_running` / `completed` with counts + `failedItemRefs` /
  `job_failed` with error). Runs with `trigger: 'manual'`. Both exported from
  `BackgroundJobsModule`.
- **Not per-item retry** — `failedItemRefs` are opaque `describeItem()`
  strings; re-run is whole-job and relies on level-triggered `findDueItems()`
  (which the module already mandates). Per-item retry stays Model 2.
- **No controller shipped** — `JobTrigger` is a service; the consumer writes
  the ~3-line endpoint and gates it with their own `Authorizer`. Dimension 8
  stays N/A (no frontend contract, no DTO).
- **`forFeature` multi-provider registration considered and rejected** — the
  cross-module DI plumbing is fragile; a central `jobs: [...]` list at
  `forRoot` is more in keeping with this module's explicit-wiring style. Noted
  in the README.

Also confirmed this repo's test transpile emits no `design:paramtypes`, so
`JobTrigger` uses explicit `@Inject(Class)` on its constructor params like
every other provider here.

**Tests:** 298/298 pass (11 new — `scheduled-job-registry.spec.ts` ×4,
`job-trigger.spec.ts` ×5, 2 added to the module spec; existing runner specs
updated for the new return type), typecheck clean.

**Follow-up, same day — read-side reporting for the admin UI
(`PostgresJobStatusService`).** Once there's a job registry and a `commons_jobs_job_run`
history, the UI needs to *read* both. Built in `adapters/postgres-drizzle/`
(reads `commons_jobs_job_run`, so Postgres-specific and opt-in — no core change):

- `getRunHistory({ jobName?, outcome?, since?, until?, limit?, cursor? })` —
  keyset-paginated log, newest first, `application`-scoped, `limit` capped 200.
- `listJobStatus()` — one `JobStatus` per job (every job that's run + every job
  named in `cadences`): `lastRun`, `lastSuccessAt`, `consecutiveFailures`
  (leading `job_failed` **or** `itemsFailed > 0`), `cadence`, `overdue`,
  `overdueBy`.
- **The missed-schedule question.** The adapter never sees `@Cron` (it's a
  decorator in the vertical; reading it needs `@nestjs/schedule` + a cron
  parser this module doesn't depend on). `PostgresJobStatusModule.forRoot({ cadences })`
  takes a *separate, hand-typed* hint per job (`'1d'` / `'2h'` / seconds) — a
  loose max-gap bound, not the cron. `overdue` = gap since last run > cadence ×
  1.5, or a `cadences`-listed job never ran. The hint is echoed back in the
  result so the UI shows "last run 3d ago / expected every 1d" and the human
  needn't know the schedule. Where no hint is given, a cadence is **inferred**
  from the median gap of that job's recent `trigger: 'scheduled'` non-failed
  runs (≥ 3 needed), flagged `source: 'inferred'`. Deliberately **not**
  enumerating each missed occurrence — needs a cron engine, synthesises
  never-recorded rows, and "overdue by 3 days" is the actionable form.
- **`PostgresJobStatusService` is a service, not a controller** — the consumer
  writes the endpoint and gates it with their `Authorizer`. Dimension 8 stays
  N/A (typed read DTOs shipped: `JobStatus`, `JobRunRecord`, `RunHistoryPage`;
  no frontend contract).
- **New files:** `job-status.service.ts` / `.module.ts` / `.spec.ts` ×2,
  `job-status.types.ts`, `cadence.ts` / `.spec.ts`.

**Tests:** 317/317 pass (19 new), typecheck clean.

**Follow-up, same day — G1 resolved: lease-table lock built (Option C).** The
user reviewed the plain-terms comparison and chose the lease lock over keeping
Option D. `adapters/postgres-drizzle/`:

- **`commons_jobs_lock` table** — `(application, lock_key)` PK, `holder`,
  `locked_until` (the lease). One row per held/recently-held job lock; no
  pruning needed (reused in place).
- **`PostgresLeaseLock implements AdvisoryLock`** — the lock is a *row*, so
  `tryAcquire`/`release` run on any pooled connection and it works through a
  transaction-mode pooler (the two things Option D can't do). Claim is a
  conditional upsert (`ON CONFLICT DO UPDATE … WHERE locked_until < now()` —
  Postgres re-checks the WHERE against the row-locked tuple, so two instances
  racing an expired lock never both win). Crash safety is the lease expiring,
  not a connection closing. A self-managed heartbeat (`setInterval`, `unref`'d,
  cleared on `onModuleDestroy`) renews `locked_until` every `leaseSeconds / 3`
  while a run holds the lock; a heartbeat that finds the row gone logs a WARN.
  `holder` = `hostname#pid#uuid` per process — release/heartbeat only touch
  this process's own row.
- **`PostgresLeaseLockModule.forRoot({ sqlExecutorToken, application, leaseSeconds? })`**
  — `leaseSeconds` default 900, min 3 (validated at `forRoot`). Exports
  `POSTGRES_LEASE_LOCK`.
- **Core: `BackgroundJobsModule.forRoot` gains `advisoryLockToken?`** — when
  set, binds `ADVISORY_LOCK` to it and **`sqlExecutorToken` becomes optional**
  (the session lock and its `SQL_EXECUTOR` are not provided at all). `forRoot`
  throws if neither token is given. Existing default-path wiring is unchanged.
- **Trade-off documented** (README table + adapter section): lease too short →
  overlapping runs; too long → slow crash recovery. `leaseSeconds` is a real
  knob the session lock doesn't have. Default path (session lock + dedicated
  connection) stays supported for consumers who don't want the table.

Dimension 7 unchanged (Pass) — `commons_jobs_lock` is another shared *reference*
schema + migration, DB instance consumer-owned. Dimension 4: `commons_jobs_lock`
also carries active `application`, same call as `commons_jobs_job_run`.

**Tests:** 326/326 pass (9 new — `postgres-lease-lock.spec.ts` ×6,
`postgres-lease-lock.module.spec.ts` ×3), typecheck clean.

---

## 2026-09-06 — repo-wide: `commons_` table-name prefix

The user asked for every table any module ships to be prefixed so a consumer
can identify the vendored tables and keep them together.
`MODULE-STANDARD.md` dimension 7 gained the rule (`commons_<module>_<table>`,
indexes/constraints too, Drizzle export identifiers unchanged). Mechanical
rename across all five modules with tables:

| Module | Old | New |
|---|---|---|
| `authorization` | `authz_role` / `authz_action` / `authz_role_permission` / `authz_user_role` / `authz_delegation` | `commons_authz_*` (+ `commons_authz_user_role_uq`, `commons_authz_user_role_lookup`, `commons_authz_delegation_grantee`; FKs updated) |
| `notification` | `notification_channel_route` / `notification_template` / `notification_provider_credential` | `commons_notification_*` (+ `_uq` / `_tenant`) |
| `audit-logging` | `audit_event` | `commons_audit_event` (+ `commons_audit_event_entity_idx`, `commons_audit_event_tenant_time_idx`) |
| `idempotency-key` | `idempotency_key` | `commons_idempotency_key` |
| `background-jobs` | `job_run` / `scheduler_lock` | `commons_jobs_job_run` / `commons_jobs_lock` (+ `commons_jobs_job_run_application_job_time_idx`) — the two unprefixed tables get a `jobs` module segment; `scheduler_lock` shortened to `lock` under it, per the user |

Touched: every `*.schema.ts`, `*.migration.sql`, the raw-SQL statements in each
repository/store/service, all specs asserting on rendered SQL, the adapter and
module READMEs, and the historical entries in this file (prose only — an
internal design doc, not a record to preserve verbatim). Export identifiers
(`authzRole`, `auditEventTable`, `jobRunTable`, `schedulerLockTable`, …) and
hyphenated file names are unchanged.

**Breaking for existing consumers** — any project that already ran a prior
migration must rename its tables (`ALTER TABLE … RENAME TO …`) or re-run from
the new reference DDL. `pay-api` has `notification` tables today; its migration
needs the rename.

**Tests:** 326/326 pass (no new tests — pure rename), typecheck clean.
