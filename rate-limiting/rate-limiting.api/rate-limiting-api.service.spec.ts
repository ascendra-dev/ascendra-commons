import { describe, expect, it, vi } from 'vitest';
import { RateLimitingApiService } from './rate-limiting-api.service';
import type { RateLimitObservabilityPort } from '../rate-limiting.core';

function service() {
  const observability: RateLimitObservabilityPort = {
    listRejections: vi.fn().mockResolvedValue({ rejections: [] }),
    rejectionCatalog: vi.fn().mockResolvedValue([]),
  };
  return { svc: new RateLimitingApiService(observability), observability };
}

describe('RateLimitingApiService', () => {
  it('listRejections parses since/until into Dates and passes filters through unchanged', async () => {
    const { svc, observability } = service();
    await svc.listRejections({
      route: '/pay/:token',
      identifier: '1.2.3.4',
      correlationId: 'corr-1',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z',
      limit: 10,
      cursor: 'cur-1',
    });

    expect(observability.listRejections).toHaveBeenCalledWith({
      route: '/pay/:token',
      identifier: '1.2.3.4',
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
    expect(observability.listRejections).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-9', limit: 5 }));
  });

  it('rejectionCatalog parses since into a Date', async () => {
    const { svc, observability } = service();
    await svc.rejectionCatalog('2026-01-01T00:00:00.000Z');
    expect(observability.rejectionCatalog).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00.000Z'));
  });
});
