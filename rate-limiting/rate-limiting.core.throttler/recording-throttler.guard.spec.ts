import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerException, ThrottlerModule } from '@nestjs/throttler';
import { RateLimitingThrottlerModule } from './rate-limiting-throttler.module';
import { RecordingThrottlerGuard } from './recording-throttler.guard';
import type { RateLimitEventRecorder, RateLimitRejection } from '../rate-limiting.core';

const RECORDER = Symbol('RECORDER');

function fakeContext(headers: Record<string, string> = {}, routePath?: string): ExecutionContext {
  const request = { ip: '203.0.113.7', headers, route: routePath ? { path: routePath } : undefined };
  const response = { header: vi.fn() };
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

function fakeRecorderModule() {
  const rejections: RateLimitRejection[] = [];
  const recorderValue: RateLimitEventRecorder = {
    recordRejection: vi.fn(async (r) => {
      rejections.push(r);
    }),
  };
  @Module({ providers: [{ provide: RECORDER, useValue: recorderValue }], exports: [RECORDER] })
  class RecorderModule {}
  return { RecorderModule, rejections };
}

describe('RecordingThrottlerGuard — real DI + @nestjs/throttler wiring', () => {
  async function build(recorderToken?: symbol, imports: unknown[] = []) {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({ throttlers: [{ limit: 1, ttl: 60_000 }] }),
        RateLimitingThrottlerModule.forRoot({
          recorderToken,
          imports: imports as import('@nestjs/common').DynamicModule['imports'],
        }),
      ],
    }).compile();
    await moduleRef.init(); // ThrottlerGuard.onModuleInit() populates this.throttlers
    return moduleRef;
  }

  it('the first request under the limit passes through without recording anything', async () => {
    const { RecorderModule, rejections } = fakeRecorderModule();
    const moduleRef = await build(RECORDER, [RecorderModule]);
    const guard = moduleRef.get(RecordingThrottlerGuard);

    await expect(guard.canActivate(fakeContext())).resolves.toBe(true);
    expect(rejections).toHaveLength(0);
  });

  it('a request exceeding the limit records the rejection AND still throws ThrottlerException', async () => {
    const { RecorderModule, rejections } = fakeRecorderModule();
    const moduleRef = await build(RECORDER, [RecorderModule]);
    const guard = moduleRef.get(RecordingThrottlerGuard);
    const context = fakeContext({}, '/pay/:token');

    await guard.canActivate(context); // 1st — under the limit of 1
    await expect(guard.canActivate(context)).rejects.toThrow(ThrottlerException); // 2nd — exceeds it

    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toMatchObject({ route: '/pay/:token', identifier: '203.0.113.7', limit: 1, ttlMs: 60_000 });
  });

  it('threads x-correlation-id into the recorded rejection when present', async () => {
    const { RecorderModule, rejections } = fakeRecorderModule();
    const moduleRef = await build(RECORDER, [RecorderModule]);
    const guard = moduleRef.get(RecordingThrottlerGuard);
    const context = fakeContext({ 'x-correlation-id': 'corr-1' });

    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toThrow(ThrottlerException);

    expect(rejections[0].correlationId).toBe('corr-1');
  });

  it.each([
    ['overlong', 'x'.repeat(129)],
    ['spaces and punctuation', 'bad id;drop'],
    ['markup', '<script>'],
    ['empty', ''],
  ])('drops a malformed x-correlation-id (%s) — the rejection still records, without it', async (_name, header) => {
    const { RecorderModule, rejections } = fakeRecorderModule();
    const guard = (await build(RECORDER, [RecorderModule])).get(RecordingThrottlerGuard);
    await expect(guard.canActivate(fakeContext({ 'x-correlation-id': header }))).resolves.toBe(true);
    await expect(guard.canActivate(fakeContext({ 'x-correlation-id': header }))).rejects.toThrow(ThrottlerException);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].correlationId).toBeUndefined();
  });

  it('keeps a well-formed one — a UUID, a W3C trace id', async () => {
    for (const id of ['5b9e1c04-2a71-4c3e-9f8a-d3b6e0c1a1a1', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01']) {
      const { RecorderModule, rejections } = fakeRecorderModule();
      const guard = (await build(RECORDER, [RecorderModule])).get(RecordingThrottlerGuard);
      await guard.canActivate(fakeContext({ 'x-correlation-id': id }));
      await expect(guard.canActivate(fakeContext({ 'x-correlation-id': id }))).rejects.toThrow(ThrottlerException);
      expect(rejections[0].correlationId).toBe(id);
    }
  });

  /** A context whose request is `request` — for adapters other than fakeContext's Express shape. */
  function contextFor(request: object): ExecutionContext {
    return {
      getHandler: () => function resolve() {},
      getClass: () => class PaymentLinkController {},
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ header: vi.fn() }) }),
    } as unknown as ExecutionContext;
  }

  it.each([
    ['Fastify (routeOptions.url)', { routeOptions: { url: '/pay/:token' } }, '/pay/:token'],
    ['older Fastify (routerPath)', { routerPath: '/pay/:token' }, '/pay/:token'],
    // No adapter says: the handler names the route — never the URL, whose token is a secret.
    ['no pattern at all', {}, 'PaymentLinkController.resolve'],
  ])('records the route pattern on %s, never the resolved URL', async (_name, adapterFields, expected) => {
    const { RecorderModule, rejections } = fakeRecorderModule();
    const guard = (await build(RECORDER, [RecorderModule])).get(RecordingThrottlerGuard);
    const context = contextFor({ ip: '203.0.113.7', headers: {}, url: '/pay/abc123?ref=mail', ...adapterFields });

    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toThrow(ThrottlerException);

    expect(rejections[0].route).toBe(expected);
    expect(JSON.stringify(rejections[0])).not.toContain('abc123');
  });

  it('defaults to a no-op recorder when recorderToken is omitted — throttling still works', async () => {
    const moduleRef = await build();
    const guard = moduleRef.get(RecordingThrottlerGuard);
    const context = fakeContext();

    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toThrow(ThrottlerException);
  });

  it('a throwing recorder never prevents the 429 — the exception still fires', async () => {
    const throwingRecorder: RateLimitEventRecorder = { recordRejection: () => Promise.reject(new Error('log down')) };
    @Module({ providers: [{ provide: RECORDER, useValue: throwingRecorder }], exports: [RECORDER] })
    class ThrowingRecorderModule {}
    const moduleRef = await build(RECORDER, [ThrowingRecorderModule]);
    const guard = moduleRef.get(RecordingThrottlerGuard);
    const context = fakeContext();

    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toThrow(ThrottlerException);
  });
});
