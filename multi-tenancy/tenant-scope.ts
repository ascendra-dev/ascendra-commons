/**
 * `'tenant'` — the ordinary scoped case, an issuer/org-style persona bound to
 * one tenant. `'payer'` (or any comparably identity-scoped, cross-tenant
 * persona) — sees only rows naming them, regardless of which tenant issued
 * them; a genuinely different case from admin, not a simplification of it.
 * `'admin'` — an unrestricted, cross-tenant bypass (support/ops).
 *
 * A project without a `'payer'`-style persona simply never produces that
 * variant — nothing else needs to change.
 */
export type TenantScope =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'payer'; payerId: string }
  | { kind: 'admin' };
