import type { Actor } from '../authorization/authorization.core';
import type { TenantScope } from './tenant-scope';

/**
 * How an `Actor` becomes a `TenantScope` — a real seam, not a hardcoded
 * assumption, because `Actor.persona` is intentionally a plain,
 * project-defined string (see `authorization.core`'s own doc comment): this
 * module has no way to know which persona string means "admin" or "payer"
 * for a given project. `DefaultTenantScopeResolver` covers the common
 * two-persona case (tenant-bound vs. unrestricted); a project with a third,
 * identity-scoped persona (a `payer`, in the project this pattern was
 * promoted from) supplies its own.
 */
export interface TenantScopeResolver {
  resolve(actor: Actor): TenantScope;
}

/**
 * The default binding when no `scopeResolverToken` is configured. An actor
 * carrying a `tenantId` is scoped to that tenant; one without is treated as
 * admin (unrestricted) — the two-persona case most projects start with.
 * A project that also has an identity-scoped persona (not bound to a fixed
 * tenant, but not an unrestricted bypass either — a `payer`, most concretely)
 * needs its own `TenantScopeResolver` that recognizes that persona and
 * returns `{ kind: 'payer', payerId: actor.id }` for it.
 */
export class DefaultTenantScopeResolver implements TenantScopeResolver {
  resolve(actor: Actor): TenantScope {
    return actor.tenantId ? { kind: 'tenant', tenantId: actor.tenantId } : { kind: 'admin' };
  }
}
