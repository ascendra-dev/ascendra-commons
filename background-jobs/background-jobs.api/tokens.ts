/** Injection tokens for `background-jobs.api`. Symbols, not string literals. */

/** Optional `JobAuditEmitter` — bound by the consumer to record manual triggers, or left as the no-op. */
export const JOB_AUDIT_EMITTER = Symbol('JOB_AUDIT_EMITTER');
