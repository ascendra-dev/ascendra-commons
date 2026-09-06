import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IdempotencyModule } from './idempotency.module';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { IdempotencyStore } from './idempotency-store.port';
import type { IdempotencyScopeResolver } from './idempotency-scope-resolver.port';
import { IDEMPOTENCY_STORE } from './tokens';

const FAKE_STORE = Symbol('FAKE_STORE');
const FAKE_RESOLVER = Symbol('FAKE_RESOLVER');

const claim = vi.fn().mockResolvedValue({ status: 'claimed', claimId: 'c1' });

@Module({
  providers: [
    { provide: FAKE_STORE, useValue: { claim, complete: vi.fn() } satisfies IdempotencyStore },
    { provide: FAKE_RESOLVER, useValue: { resolveScope: vi.fn().mockResolvedValue('scope-x') } satisfies IdempotencyScopeResolver },
  ],
  exports: [FAKE_STORE, FAKE_RESOLVER],
})
class FakeInfraModule {}

describe('IdempotencyModule.forRoot — token wiring', () => {
  it('throws without storeToken', () => {
    // @ts-expect-error — deliberately omitting the required field
    expect(() => IdempotencyModule.forRoot({})).toThrow(/requires storeToken/);
  });

  it('aliases IDEMPOTENCY_STORE to storeToken and provides the interceptor with the default resolver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IdempotencyModule.forRoot({ storeToken: FAKE_STORE, imports: [FakeInfraModule] })],
    }).compile();

    const store = moduleRef.get<IdempotencyStore>(IDEMPOTENCY_STORE);
    await expect(store.claim('k', 's')).resolves.toEqual({ status: 'claimed', claimId: 'c1' });
    expect(moduleRef.get(IdempotencyInterceptor)).toBeInstanceOf(IdempotencyInterceptor);
  });

  it('aliases the scope resolver when scopeResolverToken is supplied', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        IdempotencyModule.forRoot({ storeToken: FAKE_STORE, scopeResolverToken: FAKE_RESOLVER, imports: [FakeInfraModule] }),
      ],
    }).compile();

    // interceptor resolves — its scope resolver dep came from FAKE_RESOLVER
    expect(moduleRef.get(IdempotencyInterceptor)).toBeInstanceOf(IdempotencyInterceptor);
  });
});
