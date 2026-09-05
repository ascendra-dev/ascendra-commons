/**
 * Injection tokens for the Postgres/Drizzle authorization adapter. Symbols, not
 * string literals — a typo in a binding is a compile error, not a silently
 * unbound provider.
 */

/** Bound to the consumer's Drizzle db via `PostgresAuthorizationModule.forRoot({ sqlExecutorToken })`. */
export const AUTHZ_SQL_EXECUTOR = Symbol('AUTHZ_SQL_EXECUTOR');

/**
 * What `PostgresAuthorizationModule` exports as the `Authorizer` implementation
 * (with the optional `allowedActions`) — pass this as
 * `AuthorizationModule.forRoot({ model: 'permission-table', authorizerToken })`.
 */
export const POSTGRES_PERMISSION_TABLE_AUTHORIZER = Symbol('POSTGRES_PERMISSION_TABLE_AUTHORIZER');

/** The delegation management service — `delegate()` / `revokeDelegation()` / `listDelegations()`. */
export const AUTHZ_DELEGATION_SERVICE = Symbol('AUTHZ_DELEGATION_SERVICE');

/** `DelegationOptions` — `{ maxDelegationDays }`, from `PostgresAuthorizationModule.forRoot()`. */
export const AUTHZ_DELEGATION_OPTIONS = Symbol('AUTHZ_DELEGATION_OPTIONS');
