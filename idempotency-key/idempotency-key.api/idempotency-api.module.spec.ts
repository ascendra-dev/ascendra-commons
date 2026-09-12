import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IDEMPOTENCY_OBSERVABILITY_PORT } from '../idempotency-key.core';
import { IdempotencyApiModule } from './idempotency-api.module';
import { IdempotencyController } from './idempotency.controller';

const listClaims = vi.fn().mockResolvedValue({ claims: [] });
const getClaim = vi.fn().mockResolvedValue(null);
const claimHealthSummary = vi.fn().mockResolvedValue({
  pendingCount: 0,
  completedCount: 0,
  reclaimedCount: 0,
  lateCompleteNoOpTotal: 0,
  totalCount: 0,
  oldestRetainedAt: null,
});

@Module({
  providers: [{ provide: IDEMPOTENCY_OBSERVABILITY_PORT, useValue: { listClaims, getClaim, claimHealthSummary } }],
  exports: [IDEMPOTENCY_OBSERVABILITY_PORT],
})
class FakePortModule {}

describe('IdempotencyApiModule.forRoot — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [IdempotencyApiModule.forRoot({ imports: [FakePortModule] })],
    }).compile();
  }

  it('resolves the controller', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(IdempotencyController)).toBeInstanceOf(IdempotencyController);
  });

  it('routes GET /idempotency-keys through to the observability port', async () => {
    const moduleRef = await build();
    await moduleRef.get(IdempotencyController).claims('pending');
    expect(listClaims).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  it('routes GET /idempotency-keys/trace/:correlationId', async () => {
    const moduleRef = await build();
    await moduleRef.get(IdempotencyController).trace('trace-9');
    expect(listClaims).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trace-9' }));
  });

  it('routes GET /idempotency-keys/health', async () => {
    const moduleRef = await build();
    await moduleRef.get(IdempotencyController).health();
    expect(claimHealthSummary).toHaveBeenCalledTimes(1);
  });

  it('routes GET /idempotency-keys/:scope/:key', async () => {
    const moduleRef = await build();
    await moduleRef.get(IdempotencyController).claim('scope-1', 'key-1');
    expect(getClaim).toHaveBeenCalledWith('key-1', 'scope-1');
  });
});
