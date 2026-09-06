import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { IdempotencyModule, IDEMPOTENCY_STORE } from '../idempotency-key.core';
import type { IdempotencyStore } from '../idempotency-key.core';
import { RedisIdempotencyStoreModule } from './redis-idempotency-store.module';
import { RedisIdempotencyStore, RedisIdempotencyStoreNotImplementedError } from './redis-idempotency-store';
import { REDIS_IDEMPOTENCY_STORE } from './tokens';

describe('RedisIdempotencyStoreModule wired into IdempotencyModule — the seam, unimplemented', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [
        IdempotencyModule.forRoot({
          storeToken: REDIS_IDEMPOTENCY_STORE,
          imports: [RedisIdempotencyStoreModule.forRoot()],
        }),
      ],
    }).compile();
  }

  it('IDEMPOTENCY_STORE resolves to RedisIdempotencyStore', async () => {
    expect((await build()).get(IDEMPOTENCY_STORE)).toBeInstanceOf(RedisIdempotencyStore);
  });

  it('claim() and complete() throw RedisIdempotencyStoreNotImplementedError', async () => {
    const store = (await build()).get<IdempotencyStore>(IDEMPOTENCY_STORE);
    await expect(store.claim('k', 's')).rejects.toBeInstanceOf(RedisIdempotencyStoreNotImplementedError);
    await expect(store.complete('k', 's', 'c', { statusCode: 200, body: {} })).rejects.toBeInstanceOf(
      RedisIdempotencyStoreNotImplementedError,
    );
  });
});
