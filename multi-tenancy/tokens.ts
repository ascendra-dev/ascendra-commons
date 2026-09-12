/** Injection tokens. Symbols, not string literals. */

/** Bound to `DefaultTenantScopeResolver` by default, or to the consumer's own resolver (for a project with a third, identity-scoped persona). */
export const TENANT_SCOPE_RESOLVER = Symbol('TENANT_SCOPE_RESOLVER');
