/** Injection tokens for the Postgres/Drizzle adapter. Symbols, not string literals. */

/** The consumer's Drizzle db, aliased via `PostgresPaymentLinkTokenServiceModule.forRoot({ sqlExecutorToken })` / `PostgresTokenResolutionObservabilityModule.forRoot(...)`. */
export const PAYMENT_LINK_SQL_EXECUTOR = Symbol('PAYMENT_LINK_SQL_EXECUTOR');

/** Which Ascendra application this process is — stamped on every row, filtered on by every read. */
export const PAYMENT_LINK_APPLICATION_ID = Symbol('PAYMENT_LINK_APPLICATION_ID');

/** What `PostgresPaymentLinkTokenServiceModule` exports — pass this as `PaymentLinkSecurityModule.forRoot({ serviceToken })`. */
export const POSTGRES_PAYMENT_LINK_TOKEN_SERVICE = Symbol('POSTGRES_PAYMENT_LINK_TOKEN_SERVICE');

/** What `PostgresTokenResolutionRecorderModule` exports — pass this as `PostgresPaymentLinkTokenServiceModule.forRoot({ recorderToken })`. */
export const POSTGRES_TOKEN_RESOLUTION_RECORDER = Symbol('POSTGRES_TOKEN_RESOLUTION_RECORDER');
