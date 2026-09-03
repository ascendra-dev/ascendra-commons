import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Actor } from './authorization.types';
import { Authorizer } from './authorizer';
import { ACTION_METADATA_KEY } from './requires-action.decorator';
import { AUTHORIZER } from './tokens';

/**
 * Expects `request.actor: Actor` to already be populated by the time this
 * guard runs — by the consuming project's own authentication guard/middleware,
 * ordered before this one. This guard only answers "can this actor do this
 * action," never "who is this actor" — that's authentication, deliberately a
 * separate concern (see this module's README).
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  // Explicit @Inject(Reflector), not bare type-based constructor injection —
  // the same fix already applied to InProcessDomainEventEmitter in domain-events, for
  // the identical reason: bare type-based injection depends on
  // design:paramtypes reflection metadata that esbuild-based transpilation
  // (vitest, and any consumer building without tsc) does not reliably emit.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTHORIZER) private readonly authorizer: Authorizer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<string | undefined>(ACTION_METADATA_KEY, context.getHandler());
    if (!action) return true; // an endpoint with no declared action is not authz-gated — should be rare and explicit

    const request = context.switchToHttp().getRequest<{ actor?: Actor }>();
    const actor = request.actor;
    if (!actor) {
      // Defensive: this guard assumes an upstream authentication step already
      // populated request.actor. If it didn't (misconfigured guard order, a
      // route that skipped auth by mistake), fail as "not authenticated"
      // rather than crashing on a read of an undefined actor's persona.
      throw new UnauthorizedException();
    }

    if (!(await this.authorizer.can(actor, action))) {
      throw new ForbiddenException();
    }
    return true;
  }
}
