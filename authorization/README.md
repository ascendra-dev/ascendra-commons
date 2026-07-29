# Authorization Pattern

## Overview

Authorization (`can the actor perform this action`) is deliberately separate
from two other concerns it's easy to conflate it with: **authentication** (who
is logged in — a consuming project's own concern, e.g. Supabase Auth) and
**tenant isolation** (can the actor see this tenant's data at all — typically
enforced structurally via Postgres RLS, not by this module). This pattern only
answers the first question, backed by the minimum viable model, with a
deliberate seam for a richer permission model to be added later without
redesigning call sites.

## The pieces

### `Authorizer` — defined once, never the implementation

```typescript
export interface Actor {
  id: string;
  persona: string;
  tenantId: string | null;
}

export interface Authorizer {
  can(actor: Actor, action: string): Promise<boolean>;
}
```

Feature code calls `authorizer.can(actor, 'invoice.create')` — it never
inspects `actor.persona` directly, and never hardcodes a permission list
inline. `persona` is a plain string, not a fixed union: personas vary entirely
by project (issuer/payer/ascendra_admin in one project, teacher/student/parent
in another) — each consuming project defines its own persona set and action
catalog; this library only fixes the shape.

**`can()` returns `Promise<boolean>`, not `boolean`.** A database-backed
authorizer (Model 2, below) genuinely needs to query a permissions table,
which is inherently async — keeping the interface async from the start means
that swap is a true drop-in later, not a breaking change to every call site.
`StaticRoleMapAuthorizer` never actually awaits anything; wrapping a sync
lookup in an already-resolved promise costs nothing real.

### Enforcement is a Guard, not a scattered function call

```typescript
@Post(':id/void')
@RequiresAction('invoice.void')
voidInvoice(@Param('id') id: string, @CurrentUser() actor: Actor) { /* ... */ }
```

`RequiresAction` attaches the action as metadata; `AuthorizationGuard` reads
it and checks `authorizer.can()` before the handler runs — one action per
state-changing endpoint, declared once, not a manual `if (!can(...))`
remembered (or forgotten) per handler. An endpoint with no `@RequiresAction()`
is not authz-gated at all — that should be rare and explicit, never a default.

`AuthorizationGuard` expects `request.actor: Actor` to already be populated by
an upstream authentication guard/middleware the consuming project owns —
ordered before this one. If it's missing entirely (misconfigured guard order,
a route that skipped auth by mistake), the guard throws `UnauthorizedException`
(401 — not authenticated) rather than crashing on an undefined actor. A
present-but-not-permitted actor gets `ForbiddenException` (403 — authenticated,
not permitted). These are genuinely different things, worth keeping distinct:
a frontend that treats 401 as "session expired, log out" would badly mishandle
a 403 if the two were conflated.

### `StaticRoleMapAuthorizer` (Model 1) — data, not code

```typescript
export class StaticRoleMapAuthorizer implements Authorizer {
  constructor(personaActions: Record<string, string[] | '*'>) { /* ... */ }
  async can(actor, action) { /* looks up personaActions[actor.persona] */ }
}
```

No admin UI to manage roles, no database table for permissions — the entire
model is a constant object and a lookup function. This is intentional:
building and testing the *administration* of a permission system nobody yet
needs is the cost this pattern exists to avoid, not the concept of roles
itself. `'*'` for a persona means unrestricted access by definition (a
platform-admin persona, say), not a maintained list every new action must be
added to. A persona with **no entry at all** in the map is denied, not treated
as unrestricted — fails closed rather than silently crashing or guessing.

## `computeSessionSnapshot` — the computation behind a project's own `GET /me`

```typescript
export interface SessionSnapshot {
  actor: Actor;
  allowedActions: string[];
}
```

Not a shipped controller — the route, DTO shape, and the full list of actions
that exist are all project-specific. A consuming project writes a thin
controller:

```typescript
@Get('me')
async me(@CurrentUser() actor: Actor) {
  return computeSessionSnapshot(actor, Object.values(Actions), this.authorizer);
}
```

Fetched once at session bootstrap by the frontend. **Menus and routes are
hidden based on membership in `allowedActions` — never disabled.** A persona
that can never do something should not see it at all; this is a stable,
persona-level fact (the same for every record that persona will ever see), not
something that flickers per-record — which is exactly why it's safe to hide
rather than disable, unlike the per-resource case below.

## `computeActionAvailability` — per-entity, per-action state

```typescript
export type ActionAvailability =
  | { allowed: true }
  | { allowed: false; reason: 'not_permitted' | 'invalid_state'; message?: string };
```

For a single button on a single record — "can *this* actor void *this*
invoice right now." Two-step check, permission first, then business state, in
that order (checking state on a record the actor isn't even permitted to see
would leak information about that record to someone who shouldn't have it):

```typescript
async function computeInvoiceActions(actor: Actor, invoice: Invoice, authorizer: Authorizer) {
  return {
    void: await computeActionAvailability(actor, Actions.INVOICE_VOID, authorizer,
      () => invoice.status === 'paid' ? { valid: false, message: 'Cannot void a paid invoice' } : { valid: true }),
    download: { allowed: true as const },
  };
}
```

**Hide vs. disable, the one rule:** `reason: 'not_permitted'` → hide the
control (a permission fact — true for this actor on any instance).
`reason: 'invalid_state'` → render it disabled, `message` as the tooltip (a
state fact — true only for this particular record right now). Conflating the
two produces a disabled control the user can never figure out how to enable,
or a control that visibly appears and disappears per record for no reason a
user can see.

## What this section-level pattern deliberately does *not* try to solve

A page-level or persona-level "you can never do this" case should never reach
a live 401/403 at all — it's already known from `allowedActions` before any
request is made. A genuine, unavoidable-until-request-time 403 only happens
for **instance/tenancy-level** authorization — "does this actor own *this
specific record*" — which can't be known until the specific resource is
requested. That's the one legitimate case for a reactive, block-level
"you don't have access to this" UI state; it is not a general substitute for
proactively hiding what `allowedActions` already knows about. A list/table
endpoint is almost never this case — RLS filters inaccessible rows out of the
result set entirely, so a list returns fewer rows, not a 403; the reactive
case applies to single-record detail fetches, not tables.

## Model 1 — Static Persona Map (current)

What's shipped in this folder: `Authorizer` interface, `StaticRoleMapAuthorizer`,
`RequiresAction`/`AuthorizationGuard`, `computeSessionSnapshot`,
`computeActionAvailability`, and `AuthorizationModule.forRoot()`. Exactly three
things this deliberately does not include, and why:

- **No `PermissionTableAuthorizer`** (Model 2, below) — no concrete need for
  named roles/delegation exists yet in any consuming project.
- **No self-service "Request Access" workflow.** This would let a user denied
  a section trigger an auto-generated request routed to an admin for approval
  — a real, named enterprise IAM pattern (ServiceNow, Okta, and similar tools
  all have some version of it). But it presupposes something granular to
  *request* — Model 1's three-persona static map has no per-user grantable
  capability distinct from "which persona are you." Building request/approval
  infrastructure now would be building *more* than Model 2 itself asks for,
  before Model 2's own bar ("a specific story requires a capability the
  persona model genuinely cannot express") has been met by anything. Recorded
  here as a legitimate Model 2+ idea, not built.
- **No frontend code.** Menu-hiding and the "authorize before dispatching the
  backend call on direct navigation" pattern both belong in a frontend
  counterpart library (`ascendra-commons-ui`, not yet created) — this folder
  is backend-only, matching the rest of `ascendra-commons`.

## Model 2 — Roles and Delegated Permissions (future target)

A database-backed `Authorizer` introducing named, capability-bearing roles
assignable within a persona (e.g. an `issuer` persona holding an `owner` or
`staff` role), supporting delegation (one actor granting a subset of their own
permissions to another). Same `can()` call site — `PermissionTableAuthorizer`
resolves via a database query instead of a static map; this is exactly what
`can()`'s async signature was chosen to make painless. Only build this when a
specific story requires a capability the three-persona model genuinely cannot
express — not speculatively, and the admin screens to manage it are a
substantial effort in their own right, scoped as real stories when the time
comes, not assumed as "basic infrastructure" that ships for free with the
authorizer swap.

## Consuming this module

Copy `authorization/` into the consumer's `src/ascendra-commons/authorization/`
(see `module-packaging-pattern.md` for why vendored patterns land under one
wrapper folder), then:

```typescript
@Module({
  imports: [
    AuthorizationModule.forRoot({
      personaActions: {
        issuer: [Actions.INVOICE_CREATE, Actions.INVOICE_VIEW, Actions.INVOICE_VOID],
        payer: [Actions.INVOICE_VIEW],
        ascendra_admin: '*',
      },
    }),
  ],
})
export class AppModule {}
```

`AuthorizationModule.forRoot()` does not apply `AuthorizationGuard` globally —
it's provided and exported so the consuming project decides how to wire it:
globally (`{ provide: APP_GUARD, useExisting: AuthorizationGuard }`), or
per-controller/per-route via `@UseGuards(AuthorizationGuard)`. Either way,
`request.actor` must already be populated by an authentication guard ordered
before it — this module has no opinion on how that happens.
