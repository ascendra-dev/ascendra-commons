import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Actor } from '../authorization.core';

/**
 * Reads `request.actor` — populated by the consuming project's authentication
 * guard, exactly as `AuthorizationGuard` expects it. Throws
 * `UnauthorizedException` if absent (a route reached `authorization.api` without
 * authentication — a wiring mistake).
 */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!request.actor) throw new UnauthorizedException();
  return request.actor;
});
