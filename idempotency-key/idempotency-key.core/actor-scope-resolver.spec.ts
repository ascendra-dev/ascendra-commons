import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ActorScopeResolver } from './actor-scope-resolver';

describe('ActorScopeResolver', () => {
  it("resolves to the actor's tenantId when present", async () => {
    const resolver = new ActorScopeResolver();
    await expect(resolver.resolveScope({ actor: { id: 'u1', tenantId: 't1' } })).resolves.toBe('t1');
  });

  it("falls back to the actor's own id when tenantId is null", async () => {
    const resolver = new ActorScopeResolver();
    await expect(resolver.resolveScope({ actor: { id: 'u1', tenantId: null } })).resolves.toBe('u1');
  });

  it('throws UnauthorizedException, not a bogus scope, when there is no actor at all', async () => {
    const resolver = new ActorScopeResolver();
    await expect(resolver.resolveScope({})).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
