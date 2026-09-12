/** Injection tokens for the Postgres/Drizzle adapter. Symbols, not string literals. */

/** The consumer's Drizzle db, aliased via `PostgresWebhookEventLogModule.forRoot({ sqlExecutorToken })` / `PostgresWebhookObservabilityModule.forRoot(...)`. */
export const WEBHOOK_SQL_EXECUTOR = Symbol('WEBHOOK_SQL_EXECUTOR');

/** Which Ascendra application this process is — stamped on every row, filtered on by every read. */
export const WEBHOOK_APPLICATION_ID = Symbol('WEBHOOK_APPLICATION_ID');

/** What `PostgresWebhookEventLogModule` exports as its `WebhookEventLog` implementation. */
export const POSTGRES_WEBHOOK_EVENT_LOG = Symbol('POSTGRES_WEBHOOK_EVENT_LOG');
