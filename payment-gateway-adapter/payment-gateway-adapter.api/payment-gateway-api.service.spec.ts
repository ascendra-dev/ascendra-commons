import { describe, expect, it, vi } from 'vitest';
import { PaymentGatewayApiService } from './payment-gateway-api.service';
import type { WebhookObservabilityPort } from '../payment-gateway-adapter.core';

function service() {
  const observability: WebhookObservabilityPort = {
    listEvents: vi.fn().mockResolvedValue({ events: [] }),
    outcomeCounts: vi.fn().mockResolvedValue([]),
  };
  return { svc: new PaymentGatewayApiService(observability), observability };
}

describe('PaymentGatewayApiService', () => {
  it('listEvents parses since/until into Dates and passes filters through unchanged', async () => {
    const { svc, observability } = service();
    await svc.listEvents({
      gateway: 'stripe',
      outcome: 'signature_invalid',
      correlationId: 'corr-1',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z',
      limit: 10,
      cursor: 'cur-1',
    });

    expect(observability.listEvents).toHaveBeenCalledWith({
      gateway: 'stripe',
      outcome: 'signature_invalid',
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
    expect(observability.listEvents).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-9', limit: 5 }));
  });

  it('outcomeCounts parses since into a Date', async () => {
    const { svc, observability } = service();
    await svc.outcomeCounts('2026-01-01T00:00:00.000Z');
    expect(observability.outcomeCounts).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00.000Z'));
  });
});
