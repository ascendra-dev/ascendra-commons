import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationGuard, AuthorizationNotDeclaredError } from './authorization.guard';
import { ACTION_METADATA_KEY, NO_ACTION_REQUIRED_KEY } from './requires-action.decorator';
import { Authorizer } from './authorizer.port';
import { AUTHORIZATION_CHECKED } from './authorization-enforced.guard';

const HANDLER = function handler() {};
const CONTROLLER = class Controller {};

type Meta = { action?: string; noAction?: boolean };

function makeGuard(authorizer: Authorizer, meta: { handler?: Meta; controller?: Meta } = {}) {
  const reflector = {
    get: vi.fn((key: string, target: unknown) => {
      const m = target === HANDLER ? meta.handler : meta.controller;
      if (!m) return undefined;
      if (key === ACTION_METADATA_KEY) return m.action;
      if (key === NO_ACTION_REQUIRED_KEY) return m.noAction;
      return undefined;
    }),
  } as unknown as Reflector;
  return new AuthorizationGuard(reflector, authorizer);
}

function ctx(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => HANDLER,
    getClass: () => CONTROLLER,
  } as unknown as ExecutionContext;
}

describe('AuthorizationGuard', () => {
  it('allows a permitted actor through a @RequiresAction() endpoint', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };
    const guard = makeGuard(authorizer, { handler: { action: 'invoice.void' } });

    await expect(guard.canActivate(ctx({ actor: { id: 'u1', persona: 'issuer', tenantId: 't1' } }))).resolves.toBe(true);
  });

  it('throws ForbiddenException when the actor is present but not permitted', async () => {
    const actor = { id: 'u1', persona: 'payer', tenantId: null };
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(false) };
    const guard = makeGuard(authorizer, { handler: { action: 'invoice.void' } });

    await expect(guard.canActivate(ctx({ actor }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx({ actor }))).rejects.toThrow('it needs "invoice.void"');
    expect(authorizer.can).toHaveBeenCalledWith(actor, 'invoice.void');
  });

  it('throws UnauthorizedException when request.actor is missing on a gated endpoint', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, { handler: { action: 'invoice.void' } });

    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('deny-by-default: throws AuthorizationNotDeclaredError when neither decorator is present', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, {});

    await expect(guard.canActivate(ctx({ actor: {} }))).rejects.toBeInstanceOf(AuthorizationNotDeclaredError);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('the thrown error names the offending Controller.handler()', async () => {
    const guard = makeGuard({ can: vi.fn() }, {});

    await expect(guard.canActivate(ctx({}))).rejects.toThrow(/Controller\.handler\(\)/);
  });

  it('@NoActionRequired() on the handler lets the request through with no can() check', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, { handler: { noAction: true } });

    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('falls back to a class-level @RequiresAction() when the handler declares nothing', async () => {
    const actor = { id: 'u1', persona: 'payer', tenantId: null };
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(false) };
    const guard = makeGuard(authorizer, { controller: { action: 'invoice.manage' } });

    await expect(guard.canActivate(ctx({ actor }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorizer.can).toHaveBeenCalledWith(actor, 'invoice.manage');
  });

  it('falls back to a class-level @NoActionRequired() when the handler declares nothing', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, { controller: { noAction: true } });

    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
  });

  it('a method-level @NoActionRequired() wins over a class-level @RequiresAction()', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, {
      handler: { noAction: true },
      controller: { action: 'invoice.manage' },
    });

    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('a method-level @RequiresAction() wins over a class-level @NoActionRequired()', async () => {
    const actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };
    const guard = makeGuard(authorizer, {
      handler: { action: 'invoice.void' },
      controller: { noAction: true },
    });

    await expect(guard.canActivate(ctx({ actor }))).resolves.toBe(true);
    expect(authorizer.can).toHaveBeenCalledWith(actor, 'invoice.void');
  });
});

describe('AuthorizationGuard — marks the requests it lets through', () => {
  it('marks an allowed request, on @RequiresAction() and @NoActionRequired() routes', async () => {
    const allowed: Record<string | symbol, unknown> = { actor: { id: 'u1', persona: 'issuer', tenantId: 't1' } };
    await makeGuard({ can: vi.fn().mockResolvedValue(true) }, { handler: { action: 'invoice.void' } }).canActivate(ctx(allowed as Record<string, unknown>));
    expect(allowed[AUTHORIZATION_CHECKED]).toBe(true);

    const open: Record<string | symbol, unknown> = {};
    await makeGuard({ can: vi.fn() }, { handler: { noAction: true } }).canActivate(ctx(open as Record<string, unknown>));
    expect(open[AUTHORIZATION_CHECKED]).toBe(true);
  });

  it('never marks a request it refuses', async () => {
    const denied: Record<string | symbol, unknown> = { actor: { id: 'u1', persona: 'payer', tenantId: null } };
    await expect(
      makeGuard({ can: vi.fn().mockResolvedValue(false) }, { handler: { action: 'invoice.void' } }).canActivate(ctx(denied as Record<string, unknown>)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(denied[AUTHORIZATION_CHECKED]).toBeUndefined();
  });

  describe('denied-requests recording', () => {
    const actor = { id: 'u1', persona: 'member', tenantId: 't1' };
    const deny: Authorizer = { can: vi.fn().mockResolvedValue(false) };
    const guardWith = (recordDenial: (d: unknown) => void, authorizer = deny) => {
      const reflector = { get: vi.fn((key: string, target: unknown) => (target === HANDLER && key === ACTION_METADATA_KEY ? 'invoice.void' : undefined)) } as unknown as Reflector;
      return new AuthorizationGuard(reflector, authorizer, { recordDenial });
    };

    it('hands every 403 to the recorder — the route pattern, never the URL; a well-formed correlation id only', async () => {
      const recordDenial = vi.fn();
      const request = { actor, method: 'POST', route: { path: '/invoices/:id/void' }, url: '/invoices/inv_secret/void', headers: { 'x-correlation-id': 'req-1' } };
      await expect(guardWith(recordDenial).canActivate(ctx(request))).rejects.toBeInstanceOf(ForbiddenException);
      expect(recordDenial).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'u1', tenantId: 't1', action: 'invoice.void', method: 'POST', route: '/invoices/:id/void', correlationId: 'req-1',
      }));

      recordDenial.mockClear();
      await expect(guardWith(recordDenial).canActivate(ctx({ actor, headers: { 'x-correlation-id': 'bad id!' } }))).rejects.toBeInstanceOf(ForbiddenException);
      expect(recordDenial).toHaveBeenCalledWith(expect.objectContaining({ route: 'Controller.handler', correlationId: undefined }));
    });

    it('still answers 403 when the recorder throws, and records nothing for an allowed request', async () => {
      const throwing = vi.fn(() => { throw new Error('buffer broke'); });
      await expect(guardWith(throwing).canActivate(ctx({ actor }))).rejects.toBeInstanceOf(ForbiddenException);

      const recordDenial = vi.fn();
      await expect(guardWith(recordDenial, { can: vi.fn().mockResolvedValue(true) }).canActivate(ctx({ actor }))).resolves.toBe(true);
      expect(recordDenial).not.toHaveBeenCalled();
    });
  });
});
