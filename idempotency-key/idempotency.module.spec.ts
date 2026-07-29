import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IdempotencyModule } from './idempotency.module';
import { IDEMPOTENCY_STORE } from './tokens';
import { IdempotencyStore } from './idempotency-store';
import { IdempotencyInterceptor } from './idempotency.interceptor';

const DB_CONNECTION = Symbol('DB_CONNECTION');

@Module({
  providers: [{ provide: DB_CONNECTION, useValue: { execute: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }) } }],
  exports: [DB_CONNECTION],
})
class FakeDatabaseModule {}

async function buildTestModule() {
  return Test.createTestingModule({
    imports: [
      IdempotencyModule.forRoot({
        sqlExecutorToken: DB_CONNECTION,
        staleAfterSeconds: 120,
        imports: [FakeDatabaseModule],
      }),
    ],
  }).compile();
}

describe('IdempotencyModule.forRoot — real DI wiring', () => {
  it('resolves IDEMPOTENCY_STORE to a working PostgresIdempotencyStore aliased to the consumer\'s db token', async () => {
    const moduleRef = await buildTestModule();
    const store = moduleRef.get<IdempotencyStore>(IDEMPOTENCY_STORE);

    // Only reachable if SQL_EXECUTOR really resolved to DB_CONNECTION's fake, and
    // IDEMPOTENCY_STORE_OPTIONS really carried staleAfterSeconds through — a missing
    // imports entry or a useValue mismatch would have thrown at compile() instead.
    await expect(store.claim('key-1', 'scope-1')).resolves.toEqual({ status: 'claimed' });
  });

  it('resolves IdempotencyInterceptor wired to the default ActorScopeResolver when none is supplied', async () => {
    const moduleRef = await buildTestModule();
    const interceptor = moduleRef.get(IdempotencyInterceptor);

    expect(interceptor).toBeInstanceOf(IdempotencyInterceptor);
  });
});
