import { describe, expect, it, vi } from 'vitest';
import { PaymentLinkApiService } from './payment-link-api.service';
import type { TokenResolutionObservabilityPort } from '../payment-link-security.core';

function service() {
  const observability: TokenResolutionObservabilityPort = {
    listAttempts: vi.fn().mockResolvedValue({ attempts: [] }),
    outcomeCounts: vi.fn().mockResolvedValue([]),
  };
  return { svc: new PaymentLinkApiService(observability), observability };
}

describe('PaymentLinkApiService', () => {
  it('listAttempts parses since/until into Dates and passes filters through unchanged', async () => {
    const { svc, observability } = service();
    await svc.listAttempts({
      outcome: 'not_found',
      correlationId: 'corr-1',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z',
      limit: 10,
      cursor: 'cur-1',
    });

    expect(observability.listAttempts).toHaveBeenCalledWith({
      outcome: 'not_found',
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
    expect(observability.listAttempts).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-9', limit: 5 }));
  });

  it('outcomeCounts parses since into a Date', async () => {
    const { svc, observability } = service();
    await svc.outcomeCounts('2026-01-01T00:00:00.000Z');
    expect(observability.outcomeCounts).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('outcomeCounts with no since passes undefined', async () => {
    const { svc, observability } = service();
    await svc.outcomeCounts();
    expect(observability.outcomeCounts).toHaveBeenCalledWith(undefined);
  });
});
