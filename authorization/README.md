# Authorization Pattern

Authorization (`can the actor perform this action`) — deliberately separate from
**authentication** (who is logged in — the consuming project's concern) and
**tenant isolation** (typically Postgres RLS, not this module).

This module is split into independently-vendored packages along the seams every
consumer actually chooses between. Copy the container folder's sub-folders you
need into `src/ascendra-commons/authorization/`.

## The packages

| Package | Role | Depends on |
|---|---|---|
| **`authorization.core`** | The contract only — `Authorizer` interface, `AuthorizationGuard` + `@RequiresAction`/`@NoActionRequired` (deny-by-default), `computeSessionSnapshot`, `computeActionAvailability`, `AuthorizationModule.forRoot({ authorizerToken })`. Ships **no** working authorizer. | — |
| **`authorization.core.static-map`** | **Model 1** — a constant `persona -> actions` map, resolved in memory. Zero infrastructure. | `authorization.core` |
| **`authorization.core.permission-table`** | **Model 2 family** — stack-agnostic: ports, DTOs, the resolver, delegation rules + service, the per-request cache, the real `PermissionTableAuthorizer`. Ships no SQL. | `authorization.core` |
| **`authorization.core.permission-table.postgres-drizzle`** | **Model 2 / Postgres** — schema, migration, repositories, seed helpers. Implements the family's ports. A `…mysql-drizzle` etc. slots in beside it. | `authorization.core.permission-table` |
| **`authorization.api`** | Opt-in HTTP endpoints for a role-management / access-audit UI, over the family ports. Never touches a stack adapter. | `authorization.core`, `authorization.core.permission-table` |

Dependency direction is one-way toward `.core`. A vendored module that depends on
authorization (e.g. `file-storage`) depends on **`authorization.core` only**.

## Choosing a model

```typescript
// Model 1 — the default for a small vertical
AuthorizationModule.forRoot({
  authorizerToken: STATIC_MAP_AUTHORIZER,
  imports: [StaticMapAuthorizerModule.forRoot({ personaActions: { issuer: ['invoice.void'], payer: [] } })],
})

// Model 2 — database-backed roles + delegation, on Postgres
AuthorizationModule.forRoot({
  authorizerToken: PERMISSION_TABLE_AUTHORIZER,
  imports: [PostgresPermissionTableModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] })],
})
```

Both wire identically — a token plus the module that provides it. Every call site
(`@Inject(AUTHORIZER)`, `@RequiresAction`, the two `compute*` helpers) is
unchanged between models; that's what `can()`'s async-from-the-start signature
was chosen to make painless. Switching models = swap the token, swap the imported
module, run the seed helper once.

**When to move from Model 1 to Model 2:** when a specific story needs a
capability the persona model genuinely cannot express — a per-tenant role a user
holds independent of their persona, or one user delegating a subset of their
actions to another. Not "when we scale."

## The pieces (in `authorization.core`)

- **`Authorizer`** — `can(actor, action): Promise<boolean>`, plus optional
  one-pass `allowedActions(actor, candidates)`. Feature code calls
  `authorizer.can(actor, 'invoice.create')` — never inspects `actor.persona`.
- **`AuthorizationGuard` + `@RequiresAction` / `@NoActionRequired`** —
  deny-by-default: an endpoint under the guard with neither decorator throws
  `AuthorizationNotDeclaredError` (500, fails closed). Wire the guard globally as
  `APP_GUARD` — that's what makes deny-by-default meaningful. Expects
  `request.actor` populated by an upstream authentication guard. 401 (no actor)
  and 403 (actor, not permitted) are kept distinct.
- **`computeSessionSnapshot`** — the computation behind a project's own
  `GET /me`. Menus/routes are **hidden** on membership in `allowedActions`, never
  disabled (a stable persona-level fact).
- **`computeActionAvailability`** — per-entity button state. Permission first,
  then business state — `reason: 'not_permitted'` → hide, `reason: 'invalid_state'`
  → disable with the `message` as tooltip. Never leaks record state to an actor
  who can't act on the record.

See each package's own README for depth. Built and audited against
`MODULE-STANDARD.md`.

## Model 2 — the permission-table model

`persona` becomes a coarse label the DB model never reads; all permission comes
from **roles** (per tenant, or global) plus **minimal delegation** (one user
lending a subset of their role-derived actions to another, time-boxed,
revocable, chains blocked). RBAC, not ReBAC — resource-instance access is already
solved by tenant RLS. Role definition (which actions a role grants) is
platform-admin / migration territory; role *assignment* is tenant self-service.
Full detail in `authorization.core.permission-table/README.md` and the adapter's.

## `applicationId` / `tenantId`

No `applicationId` anywhere — an authorization decision never leaves the process
it's made in. `tenantId` *is* on `Actor` (nullable — see `actor.type.ts`); Model 2
branches on it (tenant-scoped roles and delegations), Model 1 ignores it.
