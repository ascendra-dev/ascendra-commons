import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationGuard } from './authorization.guard';
import { Authorizer } from './authorizer';

function fakeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
  } as unknown as ExecutionContext;
}

function fakeReflector(action: string | undefined): Reflector {
  return { get: vi.fn().mockReturnValue(action) } as unknown as Reflector;
}

describe('AuthorizationGuard', () => {
  it('allows the request through when the handler has no @RequiresAction() metadata', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = new AuthorizationGuard(fakeReflector(undefined), authorizer);

    await expect(guard.canActivate(fakeContext({}))).resolves.toBe(true);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when request.actor is missing entirely', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = new AuthorizationGuard(fakeReflector('invoice.void'), authorizer);

    await expect(guard.canActivate(fakeContext({}))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the actor is present but not permitted', async () => {
    const actor = { id: 'u1', persona: 'payer', tenantId: null };
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(false) };
    const guard = new AuthorizationGuard(fakeReflector('invoice.void'), authorizer);

    await expect(guard.canActivate(fakeContext({ actor }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorizer.can).toHaveBeenCalledWith(actor, 'invoice.void');
  });

  it('allows the request through when the actor is permitted', async () => {
    const actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };
    const guard = new AuthorizationGuard(fakeReflector('invoice.void'), authorizer);

    await expect(guard.canActivate(fakeContext({ actor }))).resolves.toBe(true);
  });
});
