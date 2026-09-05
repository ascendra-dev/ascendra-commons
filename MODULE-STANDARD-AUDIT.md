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
