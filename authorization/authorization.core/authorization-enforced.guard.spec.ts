import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AUTHORIZATION_CHECKED, AuthorizationEnforcedGuard, AuthorizationNotEnforcedError } from './authorization-enforced.guard';

class AuditEventsController {}
function events() {}

function ctx(request: Record<string | symbol, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => events,
    getClass: () => AuditEventsController,
  } as unknown as ExecutionContext;
}

describe('AuthorizationEnforcedGuard', () => {
  it('lets a request through that AuthorizationGuard already checked', () => {
    expect(new AuthorizationEnforcedGuard().canActivate(ctx({ [AUTHORIZATION_CHECKED]: true }))).toBe(true);
  });

  it("fails closed when AuthorizationGuard didn't run — naming the route and the fix", () => {
    const guard = new AuthorizationEnforcedGuard();
    // A signed-in actor isn't enough: without AuthorizationGuard nothing checked the route's action.
    const run = () => guard.canActivate(ctx({ actor: { id: 'u1', persona: 'member', tenantId: 't1' } }));
    expect(run).toThrow(AuthorizationNotEnforcedError);
    expect(run).toThrow(/AuditEventsController\.events\(\).*APP_GUARD/);
  });
});
