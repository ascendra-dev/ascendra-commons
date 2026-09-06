# Authorization — Postgres/Drizzle adapter (Model 2)

The database-backed authorizer for the common Ascendra stack. A project on this
stack writes **no permission-resolution code** — it points the adapter at its DB
connection, runs the migration, seeds roles from its existing persona map, and
flips `AuthorizationModule.forRoot({ model })` to `'permission-table'`.

The `authorization/` core stays stack-agnostic: it ships the `Authorizer`
interface, the guard, `computeSessionSnapshot` / `computeActionAvailability`.
This folder is one concrete `Authorizer` implementation of that interface (it
also implements the optional `allowedActions`), plus a delegation service. A
project on another stack ignores this folder and provides its own `Authorizer`.

## The model

`persona` (on `Actor`) stays a **coarse label** — the DB authorizer never reads
it. All permission comes from **roles**:

- **`commons_authz_role`** — the catalog. Platform-owned, small. `grants_all = true` is
  the `'*'` wildcard (every action, no `commons_authz_role_permission` rows needed).
- **`commons_authz_role_permission`** — which actions a role grants. `action` is a FK
  into `commons_authz_action`.
- **`commons_authz_action`** — the action catalog. `name` synced from your code's
  `Actions` const; `description` ships empty and is edited later in an admin UI.
- **`commons_authz_user_role`** — assignments. Tenant-scoped: the same user can hold
  different roles in different tenants. `tenant_id` NULL = applies everywhere
  (a platform admin).
- **`commons_authz_delegation`** — one user granting a subset of their own role-derived
  actions to another, within a tenant, time-boxed. See "Delegation" below.

`can()` resolves as: *does any assigned role (matching this tenant, or global)
have `grants_all`, or a permission row for this action, or is the action
actively delegated to this user in this tenant?*

## Wiring it

### 1. Create the tables

Re-export the schema so `drizzle-kit` picks it up:

```typescript
// src/db/schema.ts
export * from 'src/ascendra-commons/authorization/adapters/postgres-drizzle';
```

…or copy `authorization.migration.sql` into your migrations. **Requires
PostgreSQL 15+** (`NULLS NOT DISTINCT`).

### 2. Seed roles + actions

Once, at deploy time or in a migration:

```typescript
import { seedRolesFromPersonaMap, syncActions } from '.../adapters/postgres-drizzle';
import { Actions } from '@/auth/actions';

await syncActions(db, Object.values(Actions));               // catalog the action keys
await seedRolesFromPersonaMap(db, personaActions);           // one role per persona, same grants
// then assign each user to their persona-role — you own the users table:
//   INSERT INTO commons_authz_user_role (user_id, tenant_id, role_id)
//   SELECT id, tenant_id, persona FROM app_user;
```

### 3. Flip the model

```typescript
import {
  PostgresAuthorizationModule,
  POSTGRES_PERMISSION_TABLE_AUTHORIZER,
  AuthorizationCacheMiddleware,
} from 'src/ascendra-commons/authorization/adapters/postgres-drizzle';

@Module({
  imports: [
    AuthorizationModule.forRoot({
      model: 'permission-table',
      authorizerToken: POSTGRES_PERMISSION_TABLE_AUTHORIZER,
      imports: [
        PostgresAuthorizationModule.forRoot({
          sqlExecutorToken: DATABASE_CONNECTION,
          maxDelegationDays: 90,          // optional, default 90
          imports: [DatabaseModule],
        }),
      ],
    }),
  ],
})
export class AppModule implements NestModule {
  configure(c: MiddlewareConsumer) {
    c.apply(AuthorizationCacheMiddleware).forRoutes('*');   // recommended — see "Caching"
  }
}
```

Every `can()` call site, the guard, `computeSessionSnapshot`,
`computeActionAvailability` — unchanged. To switch back to Model 1, restore
`personaActions` and drop this wiring.

## Caching

Rendering one list endpoint can call `can()` dozens of times for the same
actor. `AuthorizationCacheMiddleware` opens a per-request `AsyncLocalStorage`
memo so the first lookup queries and the rest are Map hits — one query per
request instead of ~60.

- **Nothing is shared** across requests or processes — no Redis. The memo is
  built fresh per request and discarded when it ends, so a permission change is
  visible on the actor's very next request. No staleness, no cross-node
  invalidation.
- **Degrades safely** — without the middleware, every lookup just queries
  (correct, only slower).
- A node-level TTL memo is a possible later step *if profiling shows repeated
  cross-request lookups are a real cost* — not a default.

## Delegation

`AUTHZ_DELEGATION_SERVICE` (`DelegationService`) — `delegate()`,
`revokeDelegation()`, `listDelegations()`.

- **Snapshot model.** `actions` is fixed at grant time. If the granter later
  loses one, the delegation keeps carrying it until `expires_at` (mandatory,
  capped at `maxDelegationDays`) or `revoked_at`. One-call revoke.
- **Grant-time rule.** A granter can only delegate actions they hold **from
  their roles** — checked against `PermissionLoader.rolePermissions`, never
  their delegated-in actions, so **chains are blocked** (a delegated action
  can't be re-delegated).
- **Audit is yours to wire.** Call `delegate()` from a controller and emit an
  `AuditRecordRaised` there (`entityType: 'delegation'`, `action: 'granted'`,
  before/after = the delegated actions). The service takes no dependency on the
  audit-logging module.

## Managing roles

CRUD on `commons_authz_role` / `commons_authz_role_permission` / `commons_authz_user_role` is **yours**
to write against the documented schema — simple SQL, no adapter machinery. The
security split to keep:

- **Role definition** (which actions a role grants) — platform-admin only.
  Consider a dedicated action like `authz.manage_roles`, and REVOKE write grants
  on `commons_authz_role*` from the ordinary app DB role.
- **Role assignment** (which existing role a user holds) — ordinary
  tenant-scoped self-service (`authz.assign_roles`), naturally bounded by the
  same tenancy as everything that actor touches.

Serve the action list to your admin UI from your `Actions` const (or
`SELECT name, description FROM commons_authz_action`) so the "grant permission" form is
a dropdown, not a free-text field.

## Deferred (documented, not built)

- **Role hierarchy** — `commons_authz_role.parent_id`, a recursive resolution query,
  cycle detection, an inherited-vs-direct distinction in the matrix UI. Add
  `parent_id` (cheap on a small table) + swap `PermissionLoader`'s role query
  when overlapping roles become a maintenance pain.
- **Delegation, advanced** — live re-check of the granter's current
  permissions; cascade-revoke when a granter loses a role; delegation chains;
  resource-scoped delegation; approval workflows.
- **Resource-level grants** — `can(actor, action, resource?)` + an
  `authz_resource_grant` table + RLS policies aware of it. For deliberate
  cross-boundary sharing; the everyday case is already covered by tenant RLS.
- **A role-management service** — this adapter ships the decision path +
  delegation ops + schema/seed; role CRUD stays the vertical's.
- **The admin matrix UI** — frontend, a future `ascendra-commons-ui` concern.
- **Node-level TTL permission memo** (+ optional pub/sub invalidation).
