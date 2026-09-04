import { Injectable } from '@nestjs/common';
import { Actor } from './authorization.types';
import { Authorizer } from './authorizer';

/** Thrown by every PermissionTableAuthorizer method until a real Model 2 authorizer is built. */
export class PermissionTableAuthorizerNotImplementedError extends Error {
  constructor() {
    super(
      'AuthorizationModule was imported with model: "permission-table", but no ' +
        'database-backed authorizer is implemented yet. Use model: "static-persona-map" ' +
        '(the default), or implement PermissionTableAuthorizer — see permission-table-authorizer.ts.',
    );
    this.name = 'PermissionTableAuthorizerNotImplementedError';
  }
}

/**
 * Model 2 authorizer: a placeholder, deliberately unimplemented.
 *
 * The `forRoot({ model })` seam, the `Authorizer` interface, and the `AUTHORIZER`
 * token all exist now so that moving to database-backed roles later is a config
 * change at the import site, not a refactor of every call site. This class is the
 * one piece that is genuinely not done — and shipping it as a stub that throws
 * loudly is the honest state, rather than an untested authorizer that looks real.
 *
 * A real implementation has to resolve, at minimum:
 *
 * - **Data model.** RBAC, not ReBAC (see this module's README). At minimum a
 *   `roles` catalog, a `role_permissions` mapping (role -> action set), and a
 *   `user_roles` assignment (user -> one or more roles). Resolving `can()` is
 *   then: load the actor's roles, union their action sets, test membership.
 * - **Tenancy.** Role *assignment* (`user_roles`) is tenant-scoped — the same
 *   user can hold different roles in different tenants — so every lookup is keyed
 *   by `actor.id` *and* `actor.tenantId`. Role *definition* (`roles`,
 *   `role_permissions`) is a small platform-owned catalog, not tenant-editable.
 * - **The N+1 that `computeSessionSnapshot` creates.** It calls `can()` once per
 *   action in the catalog. A naive implementation issues one query per call. The
 *   fix is to load the actor's full permission set once per request (cache it on
 *   the request, or memoize per actor+tenant) and answer every `can()` from
 *   memory — or add a bespoke `getAllowedActions(actor)` method on this class
 *   (not on the `Authorizer` interface) that the snapshot can prefer when
 *   present. Decide this with a profiler, not speculatively.
 * - **The `'*'` equivalent.** `StaticRoleMapAuthorizer` has a literal `'*'` for
 *   unrestricted personas. A table-backed model needs its own representation of
 *   "this role grants everything" that does not require re-listing every action —
 *   e.g. a nullable `role_permissions.action` meaning wildcard, checked before
 *   the membership test.
 * - **Instance-level grants, if they ever appear.** `can()` may grow a third
 *   `resource` parameter (already anticipated in the README) backed by a narrow
 *   `resource_grant` table checked *in addition to* the role lookup — not a
 *   dedicated ReBAC engine.
 * - **Administration.** Role definition (platform-admin only) and role
 *   assignment (ordinary tenant-scoped self-service) are different access levels;
 *   conflating them is a privilege-escalation path. The role-definition UI is a
 *   permission matrix — see this module's README, "Administration".
 *
 * See this module's README, "Model 2 — Roles and Delegated Permissions".
 */
@Injectable()
export class PermissionTableAuthorizer implements Authorizer {
  async can(_actor: Actor, _action: string): Promise<boolean> {
    throw new PermissionTableAuthorizerNotImplementedError();
  }
}
