/**
 * Injection tokens for the Postgres/Drizzle adapter. Symbols, not string
 * literals — same reasoning as the rest of this library (a typo in a binding
 * is a compile error, not a silently unbound provider).
 */

/** Bound to the consumer's Drizzle db via `PostgresAuditPersistenceModule.forRoot({ sqlExecutorToken })`. */
export const AUDIT_SQL_EXECUTOR = Symbol('AUDIT_SQL_EXECUTOR');

/**
 * The `application` string from `PostgresAuditPersistenceModule.forRoot()` —
 * stamped into every audit row's `application` column. A plain value provided
 * inside this adapter's own module, not `domain-events`' `APPLICATION_ID`:
 * the adapter stays usable whether or not the consumer passes `application`
 * to `DomainEventsModule.forRoot()`. Same string either way.
 *
 * Module-prefixed (`AUDIT_`) so it never collides with any other module's
 * application token — the naming convention across this library for
 * per-module tokens that happen to carry the same kind of value.
 */
export const AUDIT_APPLICATION_ID = Symbol('AUDIT_APPLICATION_ID');

/**
 * What `PostgresAuditPersistenceModule` exports — pass this as
 * `AuditLoggingModule.forRoot({ auditEventRepositoryToken })`, with the
 * persistence module in that same call's `imports`.
 */
export const POSTGRES_AUDIT_EVENT_REPOSITORY = Symbol('POSTGRES_AUDIT_EVENT_REPOSITORY');
