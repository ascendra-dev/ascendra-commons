import { Inject, Injectable } from '@nestjs/common';
import { Actor } from './authorization.types';
import { PERSONA_ACTIONS_DATA } from './tokens';

/**
 * An interface, not a class — same reasoning as every Model 1/Model 2 pair in
 * this library: static (here) and database-backed (a consuming project's own
 * PermissionTableAuthorizer, once a real need for named roles/delegation
 * appears) share no behavior with each other.
 *
 * can() returns Promise<boolean>, not boolean, even though
 * StaticRoleMapAuthorizer never actually awaits anything — a database-backed
 * implementation genuinely needs to query a permissions table, which is
 * inherently async. Keeping the interface async from the start means Model 2
 * is a true drop-in swap later, not a breaking change to every call site.
 */
export interface Authorizer {
  can(actor: Actor, action: string): Promise<boolean>;
}

/**
 * Feature code calls authorizer.can(actor, 'invoice.create') — it never
 * inspects actor.persona directly, and never hardcodes a permission list
 * inline. No admin UI to manage roles, no database table for permissions —
 * the entire model is a constant object and a lookup function. This is
 * intentional: building and testing the *administration* of a permission
 * system nobody yet needs is the cost this pattern exists to avoid, not the
 * concept of roles itself.
 *
 * '*' for a persona means unrestricted access by definition (a platform-admin
 * persona, say) — not a maintained list every new action must be added to.
 */
@Injectable()
export class StaticRoleMapAuthorizer implements Authorizer {
  constructor(@Inject(PERSONA_ACTIONS_DATA) private readonly personaActions: Record<string, string[] | '*'>) {}

  async can(actor: Actor, action: string): Promise<boolean> {
    const allowed = this.personaActions[actor.persona];
    if (allowed === undefined) return false; // an unconfigured persona is denied, not treated as unrestricted
    return allowed === '*' ? true : allowed.includes(action);
  }
}
