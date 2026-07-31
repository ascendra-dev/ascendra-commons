import { describe, expect, it, vi } from 'vitest';
import { CallHandler, ConflictException, ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyStore } from './idempotency-store';
import { IdempotencyScopeResolver } from './idempotency-scope-resolver.interface';

function fakeContext(headers: Record<string, string>, method = 'POST'): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, method }) }),
    getHandler: () => function handler() {},
  } as unknown as ExecutionContext;
}

function fakeHandler(observable: Observable<unknown>): CallHandler {
  return { handle: () => observable };
}

function fakeReflector(explicitCode?: number): Reflector {
  return { get: vi.fn().mockReturnValue(explicitCode) } as unknown as Reflector;
}

const passthroughScopeResolver: IdempotencyScopeResolver = { resolveScope: vi.fn().mockResolvedValue('scope-1') };

describe('IdempotencyInterceptor', () => {
  it('passes through untouched when no Idempotency-Key header is present', async () => {
    const store: IdempotencyStore = { claim: vi.fn(), complete: vi.fn() };
    const interceptor = new IdempotencyInterceptor(store, passthroughScopeResolver, fakeReflector());
    const handler = fakeHandler(of({ ok: true }));

    const result = await interceptor.intercept(fakeContext({}), handler);

    expect(await firstValueFrom(result)).toEqual({ ok: true });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it('claims, runs the handler, and caches the real status code — not a hardcoded 200', async () => {
    const store: IdempotencyStore = {
      claim: vi.fn().mockResolvedValue({ status: 'claimed' }),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const interceptor = new IdempotencyInterceptor(store, passthroughScopeResolver, fakeReflector(201));
    const handler = fakeHandler(of({ id: 'inv-1' }));

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), handler);

    expect(await firstValueFrom(result)).toEqual({ id: 'inv-1' });
    expect(store.complete).toHaveBeenCalledWith('k1', 'scope-1', { statusCode: 201, body: { id: 'inv-1' } });
  });

  it("falls back to NestJS's own POST default (201) when no @HttpCode() metadata is present", async () => {
    const store: IdempotencyStore = {
      claim: vi.fn().mockResolvedValue({ status: 'claimed' }),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const interceptor = new IdempotencyInterceptor(store, passthroughScopeResolver, fakeReflector(undefined));
    const handler = fakeHandler(of({ id: 'inv-1' }));

    await firstValueFrom(await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }, 'POST'), handler));

    expect(store.complete).toHaveBeenCalledWith('k1', 'scope-1', expect.objectContaining({ statusCode: 201 }));
  });

  it('does not emit the response until the cache write has actually landed', async () => {
    const store: IdempotencyStore = {
      claim: vi.fn().mockResolvedValue({ status: 'claimed' }),
      complete: vi.fn(),
    };
    let completeResolved = false;
    store.complete = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(() => { completeResolved = true; resolve(); }, 5)),
    );
    const interceptor = new IdempotencyInterceptor(store, passthroughScopeResolver, fakeReflector(200));
    const handler = fakeHandler(of({ ok: true }));

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), handler);
    await firstValueFrom(result);

    expect(completeResolved).toBe(true);
  });

  it('throws ConflictException for an in-progress duplicate, never touching the handler', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue({ status: 'in_progress' }), complete: vi.fn() };
    const interceptor = new IdempotencyInterceptor(store, passthroughScopeResolver, fakeReflector());
    const handler: CallHandler = { handle: vi.fn() };

    await expect(interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), handler)).rejects.toBeInstanceOf(ConflictException);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('replays a cached success response without touching the handler', async () => {
    const store: IdempotencyStore = {
      claim: vi.fn().mockResolvedValue({ status: 'completed', response: { statusCode: 200, body: { cached: true } } }),
      complete: vi.fn(),
    };
    const interceptor = new IdempotencyInterceptor(store, passthroughScopeResolver, fakeReflector());
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
    const interceptor = new IdempotencyInterceptor(store, passthroughScopeResolver, fakeReflector());
    const handler: CallHandler = { handle: vi.fn() };

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), handler);
    await expect(firstValueFrom(result)).rejects.toMatchObject({ status: 422 });
  });

  it('caches a definitive HttpException failure and still rethrows it', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue({ status: 'claimed' }), complete: vi.fn().mockResolvedValue(undefined) };
    const interceptor = new IdempotencyInterceptor(store, passthroughScopeResolver, fakeReflector());
    const error = new HttpException({ message: 'insufficient funds' }, 402);
    const handler = fakeHandler(throwError(() => error));

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), handler);
    await expect(firstValueFrom(result)).rejects.toBe(error);

    expect(store.complete).toHaveBeenCalledWith('k1', 'scope-1', { statusCode: 402, body: { message: 'insufficient funds' } });
  });

  it('does not cache a non-HttpException error — a retry should re-attempt, not replay it', async () => {
    const store: IdempotencyStore = { claim: vi.fn().mockResolvedValue({ status: 'claimed' }), complete: vi.fn() };
    const interceptor = new IdempotencyInterceptor(store, passthroughScopeResolver, fakeReflector());
    const error = new Error('connection reset');
    const handler = fakeHandler(throwError(() => error));

    const result = await interceptor.intercept(fakeContext({ 'idempotency-key': 'k1' }), handler);
    await expect(firstValueFrom(result)).rejects.toBe(error);

    expect(store.complete).not.toHaveBeenCalled();
  });
});
