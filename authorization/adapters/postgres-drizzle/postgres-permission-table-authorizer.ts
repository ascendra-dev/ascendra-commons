import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../authorization.types';
import type { Authorizer } from '../../authorizer';
import { PermissionLoader } from './permission-loader';

/**
 * The database-backed `Authorizer` (Model 2) for Postgres/Drizzle. Resolves
 * `can()` from the actor's assigned roles plus any active delegations — never
 * from `actor.persona`, which is a coarse label the DB model doesn't consult
 * (see the adapter README).
 *
 * Both methods share one load (`PermissionLoader.effectivePermissions`), which
 * is one query behind the per-request cache — so a single `can()` is one query,
 * and `allowedActions()` for a `/me` endpoint is also one query rather than one
 * per action. Implementing the optional `allowedActions` is what lets
 * `computeSessionSnapshot` take the one-query path automatically.
 */
@Injectable()
export class PostgresPermissionTableAuthorizer implements Authorizer {
  // Explicit @Inject — bare type-based injection depends on design:paramtypes
  // metadata that esbuild (vitest, and any consumer building without tsc) does
  // not reliably emit. Same fix as InProcessDomainEventEmitter / AuthorizationGuard.
  constructor(@Inject(PermissionLoader) private readonly loader: PermissionLoader) {}

  async can(actor: Actor, action: string): Promise<boolean> {
    const perms = await this.loader.effectivePermissions(actor);
    return perms.grantsAll || perms.actions.has(action);
  }

  async allowedActions(actor: Actor, candidateActions: string[]): Promise<string[]> {
    const perms = await this.loader.effectivePermissions(actor);
    return perms.grantsAll ? [...candidateActions] : candidateActions.filter((a) => perms.actions.has(a));
  }
}
