import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthorizationEnforcedGuard } from '../../authorization/authorization.core';
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
const claimsByRoute = vi.fn().mockResolvedValue([]);

@Module({
  providers: [{ provide: IDEMPOTENCY_OBSERVABILITY_PORT, useValue: { listClaims, getClaim, claimHealthSummary, claimsByRoute } }],
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

  it('routes GET /idempotency-keys through to the observability port, as a cursor list', async () => {
    const moduleRef = await build();
    listClaims.mockResolvedValueOnce({ claims: [{ key: 'k1' }], nextCursor: 'next' });
    await expect(moduleRef.get(IdempotencyController).claims('pending', undefined, '/payments')).resolves.toEqual({
      data: [{ key: 'k1' }],
      meta: { nextCursor: 'next' },
    });
    expect(listClaims).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', route: '/payments' }));
  });

  it('routes GET /idempotency-keys/trace/:correlationId', async () => {
    const moduleRef = await build();
    // The last page: no nextCursor, so meta is empty once serialized.
    await expect(moduleRef.get(IdempotencyController).trace('trace-9')).resolves.toEqual({ data: [], meta: { nextCursor: undefined } });
    expect(listClaims).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trace-9' }));
  });

  it('routes GET /idempotency-keys/health', async () => {
    const moduleRef = await build();
    await moduleRef.get(IdempotencyController).health('2026-10-21T00:00:00.000Z');
    expect(claimHealthSummary).toHaveBeenCalledWith({ since: new Date('2026-10-21T00:00:00.000Z') });
  });

  it('routes GET /idempotency-keys/routes', async () => {
    const moduleRef = await build();
    await moduleRef.get(IdempotencyController).routes();
    expect(claimsByRoute).toHaveBeenCalledWith({ since: undefined });
  });

  it('declares AuthorizationEnforcedGuard on the whole controller', () => {
    // A missing global AuthorizationGuard must be a 500, never every signed-in user reading saved responses.
    expect(Reflect.getMetadata(GUARDS_METADATA, IdempotencyController)).toContain(AuthorizationEnforcedGuard);
  });

  it('routes GET /idempotency-keys/:scope/:key', async () => {
    const moduleRef = await build();
    await moduleRef.get(IdempotencyController).claim('scope-1', 'key-1');
    expect(getClaim).toHaveBeenCalledWith('key-1', 'scope-1');
  });
});
