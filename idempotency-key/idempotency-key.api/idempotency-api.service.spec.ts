import { describe, expect, it, vi } from 'vitest';
import { IdempotencyApiService } from './idempotency-api.service';
import type { IdempotencyObservabilityPort } from '../idempotency-key.core';

function service() {
  const observability: IdempotencyObservabilityPort = {
    getClaim: vi.fn().mockResolvedValue(null),
    listClaims: vi.fn().mockResolvedValue({ claims: [] }),
    claimHealthSummary: vi.fn().mockResolvedValue({
      pendingCount: 0,
      completedCount: 0,
      reclaimedCount: 0,
      lateCompleteNoOpTotal: 0,
      totalCount: 0,
      oldestRetainedAt: null,
    }),
  };
  return { svc: new IdempotencyApiService(observability), observability };
}

describe('IdempotencyApiService', () => {
  it('getClaim delegates key + scope through unchanged', async () => {
    const { svc, observability } = service();
    await svc.getClaim('k1', 's1');
    expect(observability.getClaim).toHaveBeenCalledWith('k1', 's1');
  });

  it('listClaims parses since/until into Dates and passes filters through unchanged', async () => {
    const { svc, observability } = service();
    await svc.listClaims({
      status: 'pending',
      scope: 's1',
      correlationId: 'corr-1',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z',
      limit: 10,
      cursor: 'cur-1',
    });

    expect(observability.listClaims).toHaveBeenCalledWith({
      status: 'pending',
      scope: 's1',
      correlationId: 'corr-1',
      since: new Date('2026-01-01T00:00:00.000Z'),
      until: new Date('2026-02-01T00:00:00.000Z'),
      limit: 10,
      cursor: 'cur-1',
    });
  });

  it('getTrace overrides correlationId onto the base query', async () => {
    const { svc, observability } = service();
    await svc.getTrace('corr-9', { limit: 5 });
    expect(observability.listClaims).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-9', limit: 5 }));
  });

  it('claimHealthSummary delegates to the observability port', async () => {
    const { svc, observability } = service();
    await svc.claimHealthSummary();
    expect(observability.claimHealthSummary).toHaveBeenCalledTimes(1);
  });
});
