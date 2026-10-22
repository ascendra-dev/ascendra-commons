import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, CallHandler, ConflictException, ExecutionContext, HttpException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { IdempotencyStore } from './idempotency-store.port';
import type { IdempotencyScopeResolver } from './idempotency-scope-resolver.port';

function fakeContext(headers: Record<string, string>, method = 'POST', extra: Record<string, unknown> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, method, ...extra }) }),
    getHandler: () => function create() {},
    getClass: () => class InvoicesController {},
  } as unknown as ExecutionContext;
}

function fakeHandler(observable: Observable<unknown>): CallHandler {
  return { handle: () => observable };
}

function fakeReflector(explicitCode?: number): Reflector {
  return { get: vi.fn().mockReturnValue(explicitCode) } as unknown as Reflector;
}

const scopeResolver: IdempotencyScopeResolver = { resolveScope: vi.fn().mockResolvedValue('scope-1') };
const CLAIMED = { status: 'claimed' as const, claimId: 'claim-abc', reclaimedStale: false };

describe('IdempotencyInterceptor', () => {
  it('passes through untouched when no Idempotency-Key header is present', async () => {
    const store: IdempotencyStore = { claim: vi.fn(), complete: vi.fn() };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector());

    const result = await interceptor.intercept(fakeContext({}), fakeHandler(of({ ok: true })));

    expect(await firstValueFrom(result)).toEqual({ ok: true });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it.each([
    ['longer than 255 characters', 'k'.repeat(256)],
    ['non-ASCII', 'order-✓'],
    ['a control character', 'order\t1'],
  ])('rejects a key %s with a 400, before resolving a scope or claiming', async (_label, key) => {
    const store: IdempotencyStore = { claim: vi.fn(), complete: vi.fn() };
    const resolver: IdempotencyScopeResolver = { resolveScope: vi.fn() };
    const interceptor = new IdempotencyInterceptor(store, resolver, fakeReflector());
    const handler: CallHandler = { handle: vi.fn() };

    await expect(interceptor.intercept(fakeContext({ 'idempotency-key': key }), handler)).rejects.toBeInstanceOf(BadRequestException);
    expect(resolver.resolveScope).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('accepts a 255-character key and one with spaces or punctuation', async () => {
    for (const key of ['k'.repeat(255), 'order 42 | retry #1']) {
      const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue(CLAIMED), complete: vi.fn().mockResolvedValue(undefined) };
      const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector());
      await firstValueFrom(await interceptor.intercept(fakeContext({ 'idempotency-key': key }), fakeHandler(of({}))));
      expect(store.claim).toHaveBeenCalledWith(key, 'scope-1', expect.anything());
    }
  });

  it('claims, runs the handler, and completes with the claimId + the real status code', async () => {
    const store: IdempotencyStore = {
      claim: vi.fn().mockResolvedValue(CLAIMED),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector(201));

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), fakeHandler(of({ id: 'inv-1' })));

    expect(await firstValueFrom(result)).toEqual({ id: 'inv-1' });
    expect(store.complete).toHaveBeenCalledWith('k1', 'scope-1', 'claim-abc', { statusCode: 201, body: { id: 'inv-1' } });
  });

  it("falls back to NestJS's own POST default (201) when no @HttpCode() metadata is present", async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue(CLAIMED), complete: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector(undefined));

    await firstValueFrom(await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }, 'POST'), fakeHandler(of({ id: 'inv-1' }))));

    expect(store.complete).toHaveBeenCalledWith('k1', 'scope-1', 'claim-abc', expect.objectContaining({ statusCode: 201 }));
  });

  it('does not emit the response until the cache write has actually landed', async () => {
    let completeResolved = false;
    const store: IdempotencyStore = {
      claim: vi.fn().mockResolvedValue(CLAIMED),
      complete: vi.fn().mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(() => { completeResolved = true; resolve(); }, 5)),
      ),
    };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector(200));

    await firstValueFrom(await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), fakeHandler(of({ ok: true }))));

    expect(completeResolved).toBe(true);
  });

  it('throws ConflictException for an in-progress duplicate, never touching the handler', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue({ status: 'in_progress' }), complete: vi.fn() };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector());
    const handler: CallHandler = { handle: vi.fn() };

    await expect(interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), handler)).rejects.toBeInstanceOf(ConflictException);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('replays a cached success response without touching the handler', async () => {
    const store: IdempotencyStore = {
      claim: vi.fn().mockResolvedValue({ status: 'completed', response: { statusCode: 200, body: { cached: true } } }),
      complete: vi.fn(),
    };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector());
    const handler: CallHandler = { handle: vi.fn() };

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), handler);

    expect(await firstValueFrom(result)).toEqual({ cached: true });
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('replays a cached error as that same error, not as a success', async () => {
    const store: IdempotencyStore = {
      claim: vi.fn().mockResolvedValue({ status: 'completed', response: { statusCode: 422, body: { message: 'invalid' } } }),
      complete: vi.fn(),
    };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector());

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), { handle: vi.fn() });
    await expect(firstValueFrom(result)).rejects.toMatchObject({ status: 422 });
  });

  it('caches a definitive HttpException failure (with the claimId) and still rethrows it', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue(CLAIMED), complete: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector());
    const error = new HttpException({ message: 'insufficient funds' }, 402);

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), fakeHandler(throwError(() => error)));
    await expect(firstValueFrom(result)).rejects.toBe(error);

    expect(store.complete).toHaveBeenCalledWith('k1', 'scope-1', 'claim-abc', { statusCode: 402, body: { message: 'insufficient funds' } });
  });

  it('does not cache a non-HttpException error — a retry should re-attempt, not replay it', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue(CLAIMED), complete: vi.fn() };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector());
    const error = new Error('connection reset');

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), fakeHandler(throwError(() => error)));
    await expect(firstValueFrom(result)).rejects.toBe(error);

    expect(store.complete).not.toHaveBeenCalled();
  });

  it('reads x-correlation-id and threads it into store.claim()', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue(CLAIMED), complete: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector(200));

    await firstValueFrom(
      await interceptor.intercept(
        fakeContext({ 'idempotency-key': 'k1', 'x-correlation-id': 'corr-1' }),
        fakeHandler(of({ ok: true })),
      ),
    );

    expect(store.claim).toHaveBeenCalledWith('k1', 'scope-1', expect.objectContaining({ correlationId: 'corr-1' }));
  });

  it('drops a malformed x-correlation-id rather than recording caller-controlled junk', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue(CLAIMED), complete: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector(200));

    await firstValueFrom(
      await interceptor.intercept(
        fakeContext({ 'idempotency-key': 'k1', 'x-correlation-id': '<script>' + 'x'.repeat(200) }),
        fakeHandler(of({ ok: true })),
      ),
    );

    expect(store.claim).toHaveBeenCalledWith('k1', 'scope-1', expect.objectContaining({ correlationId: undefined }));
  });

  it('claims with the route pattern — Express, then Fastify, then Controller.handler — never the URL', async () => {
    const claimWith = async (extra: Record<string, unknown>) => {
      const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue(CLAIMED), complete: vi.fn().mockResolvedValue(undefined) };
      const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector(200));
      await firstValueFrom(
        await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }, 'POST', extra), fakeHandler(of({}))),
      );
      return (store.claim as ReturnType<typeof vi.fn>).mock.calls[0][2].route;
    };

    expect(await claimWith({ route: { path: '/payments/:id' }, url: '/payments/42' })).toBe('/payments/:id');
    expect(await claimWith({ routeOptions: { url: '/payments/:id' } })).toBe('/payments/:id');
    expect(await claimWith({ routerPath: '/payments/:id' })).toBe('/payments/:id');
    expect(await claimWith({ url: '/payments/42' })).toBe('InvoicesController.create');
  });

  it('claims with undefined correlationId when the header is absent', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue(CLAIMED), complete: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector(200));

    await firstValueFrom(await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), fakeHandler(of({ ok: true }))));

    expect(store.claim).toHaveBeenCalledWith('k1', 'scope-1', expect.objectContaining({ correlationId: undefined }));
  });

  it('logs a warning, but proceeds exactly as a fresh claim, when reclaimedStale is true', async () => {
    const store: IdempotencyStore = {
      claim: vi.fn().mockResolvedValue({ status: 'claimed', claimId: 'claim-abc', reclaimedStale: true }),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector(200));
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), fakeHandler(of({ ok: true })));

    expect(await firstValueFrom(result)).toEqual({ ok: true });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('k1');
  });

  it('does not log when reclaimedStale is false', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue(CLAIMED), complete: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new IdempotencyInterceptor(store, scopeResolver, fakeReflector(200));
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await firstValueFrom(await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), fakeHandler(of({ ok: true }))));

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
