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

  it('falls back to request.url when route is not populated', async () => {
    const { RecorderModule, rejections } = fakeRecorderModule();
    const moduleRef = await build(RECORDER, [RecorderModule]);
    const guard = moduleRef.get(RecordingThrottlerGuard);
    const request = { ip: '203.0.113.7', headers: {}, url: '/pay/abc123' };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class TestController {},
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ header: vi.fn() }) }),
    } as unknown as ExecutionContext;

    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toThrow(ThrottlerException);

    expect(rejections[0].route).toBe('/pay/abc123');
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
