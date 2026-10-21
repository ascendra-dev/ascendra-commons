import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { IdempotencyApiService } from './idempotency-api.service';
import { InvalidIdempotencyCursorError, type IdempotencyObservabilityPort } from '../idempotency-key.core';

function service() {
  const observability: IdempotencyObservabilityPort = {
    getClaim: vi.fn().mockResolvedValue(null),
    listClaims: vi.fn().mockResolvedValue({ claims: [] }),
    claimHealthSummary: vi.fn().mockResolvedValue({
      pendingCount: 0,
      completedCount: 0,
      reclaimedCount: 0,
      lateCompleteNoOpTotal: 0,
      replayTotal: 0,
      conflictTotal: 0,
      totalCount: 0,
      oldestRetainedAt: null,
    }),
    claimsByRoute: vi.fn().mockResolvedValue([]),
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
      route: '/payments/:id',
      correlationId: 'corr-1',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z',
      limit: 10,
      cursor: 'cur-1',
    });

    expect(observability.listClaims).toHaveBeenCalledWith({
      status: 'pending',
      scope: 's1',
      route: '/payments/:id',
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

  it('claimHealthSummary passes since as a Date, or none', async () => {
    const { svc, observability } = service();
    await svc.claimHealthSummary();
    await svc.claimHealthSummary('2026-10-21T00:00:00.000Z');
    expect(observability.claimHealthSummary).toHaveBeenNthCalledWith(1, { since: undefined });
    expect(observability.claimHealthSummary).toHaveBeenNthCalledWith(2, { since: new Date('2026-10-21T00:00:00.000Z') });
  });

  it('claimsByRoute passes since as a Date', async () => {
    const { svc, observability } = service();
    await svc.claimsByRoute('2026-10-21T00:00:00.000Z');
    expect(observability.claimsByRoute).toHaveBeenCalledWith({ since: new Date('2026-10-21T00:00:00.000Z') });
  });

  it('a malformed date is a 400, not a 500 at the driver', async () => {
    const { svc, observability } = service();
    expect(() => svc.claimsByRoute('yesterday')).toThrow(BadRequestException);
    expect(() => svc.claimHealthSummary('yesterday')).toThrow(BadRequestException);
    await expect(svc.listClaims({ until: 'soon' })).rejects.toBeInstanceOf(BadRequestException);
    expect(observability.claimsByRoute).not.toHaveBeenCalled();
  });

  it('a limit that is not a positive whole number is a 400', async () => {
    const { svc, observability } = service();
    for (const limit of [Number.NaN, 0, -5, 2.5]) {
      await expect(svc.listClaims({ limit })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(observability.listClaims).not.toHaveBeenCalled();
  });

  it('a cursor the adapter never issued is a 400', async () => {
    const { svc, observability } = service();
    vi.mocked(observability.listClaims).mockRejectedValueOnce(new InvalidIdempotencyCursorError('nope'));
    await expect(svc.listClaims({ cursor: 'garbage' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
