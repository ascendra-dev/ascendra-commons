import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IdempotencyModule, IdempotencyInterceptor, IDEMPOTENCY_STORE } from '../idempotency-key.core';
import type { IdempotencyStore } from '../idempotency-key.core';
import { PostgresIdempotencyStoreModule } from './postgres-idempotency-store.module';
import { PostgresIdempotencyStore } from './postgres-idempotency-store';
import { POSTGRES_IDEMPOTENCY_STORE } from './tokens';

const DB = Symbol('DB');

@Module({
  providers: [{ provide: DB, useValue: { execute: vi.fn().mockResolvedValue({ rows: [{ claim_id: 'c-1' }] }) } }],
  exports: [DB],
})
class FakeDatabaseModule {}

describe('PostgresIdempotencyStoreModule wired into IdempotencyModule', () => {
  it('resolves IDEMPOTENCY_STORE to a working PostgresIdempotencyStore aliased to the consumer db token', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        IdempotencyModule.forRoot({
          storeToken: POSTGRES_IDEMPOTENCY_STORE,
          imports: [
            PostgresIdempotencyStoreModule.forRoot({ sqlExecutorToken: DB, staleAfterSeconds: 120, imports: [FakeDatabaseModule] }),
          ],
        }),
      ],
    }).compile();

    expect(moduleRef.get(POSTGRES_IDEMPOTENCY_STORE)).toBeInstanceOf(PostgresIdempotencyStore);
    const store = moduleRef.get<IdempotencyStore>(IDEMPOTENCY_STORE);
    await expect(store.claim('key-1', 'scope-1')).resolves.toMatchObject({ status: 'claimed' });
    expect(moduleRef.get(IdempotencyInterceptor)).toBeInstanceOf(IdempotencyInterceptor);
  });

  it('forRoot throws on a non-positive staleAfterSeconds', () => {
    expect(() => PostgresIdempotencyStoreModule.forRoot({ sqlExecutorToken: DB, staleAfterSeconds: 0 })).toThrow(
      /staleAfterSeconds/,
    );
    // @ts-expect-error — deliberately omitting the required field
    expect(() => PostgresIdempotencyStoreModule.forRoot({ sqlExecutorToken: DB })).toThrow(/staleAfterSeconds/);
  });
});
