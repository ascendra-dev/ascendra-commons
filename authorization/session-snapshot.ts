import { Actor } from './authorization.types';
import { Authorizer } from './authorizer';

export interface SessionSnapshot {
  actor: Actor;
  allowedActions: string[];
}

/**
 * The computation behind a project's own `GET /me` endpoint — not a shipped
 * controller, since the route, DTO shape, and the full list of actions that
 * exist are all project-specific. A consuming project writes a thin
 * controller calling this:
 *
 *   @Get('me')
 *   async me(@CurrentUser() actor: Actor) {
 *     return computeSessionSnapshot(actor, Object.values(Actions), this.authorizer);
 *   }
 *
 * Fetched once at session bootstrap by the frontend. Menus/routes are hidden
 * based on membership in allowedActions — never disabled, since a persona
 * that can never do something should not see it at all (see this module's
 * README, "Hide vs. disable").
 */
export async function computeSessionSnapshot(
  actor: Actor,
  allActions: string[],
  authorizer: Authorizer,
): Promise<SessionSnapshot> {
  const checks = await Promise.all(allActions.map((action) => authorizer.can(actor, action)));
  const allowedActions = allActions.filter((_, index) => checks[index]);
  return { actor, allowedActions };
}
