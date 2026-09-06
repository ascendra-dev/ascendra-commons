/**
 * Injection token for the Postgres/Drizzle adapter. Symbol, not a string literal
 * — a typo in a binding is a compile error, not a silently unbound provider.
 *
 * The family tokens (`PERMISSION_TABLE_AUTHORIZER`, `AUTHZ_DELEGATION_SERVICE`,
 * `AUTHZ_ADMIN_PORT`, `AUTHZ_OBSERVABILITY_PORT`, …) come from
 * `authorization.core.permission-table`.
 */

/** Bound to the consumer's Drizzle db via `PostgresPermissionTableModule.forRoot({ sqlExecutorToken })` / `PostgresAuthzAdminModule.forRoot(...)`. */
export const AUTHZ_SQL_EXECUTOR = Symbol('AUTHZ_SQL_EXECUTOR');
