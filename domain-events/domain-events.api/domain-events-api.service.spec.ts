import { describe, expect, it, vi } from 'vitest';
import { DomainEventsApiService } from './domain-events-api.service';
import type { EventDeliveryObservabilityPort, EventListenerCatalogPort } from '../domain-events.core';

function service() {
  const deliveries: EventDeliveryObservabilityPort = {
    listDeliveries: vi.fn().mockResolvedValue({ deliveries: [] }),
    deliveryCatalog: vi.fn().mockResolvedValue([]),
  };
  const listenerCatalog: EventListenerCatalogPort = {
    list: vi.fn().mockResolvedValue([]),
  };
  return { svc: new DomainEventsApiService(deliveries, listenerCatalog), deliveries, listenerCatalog };
}

describe('DomainEventsApiService', () => {
  it('listDeliveries parses since/until into Dates and passes filters through unchanged', async () => {
    const { svc, deliveries } = service();
    await svc.listDeliveries({
      eventName: 'invoice.sent',
      method: 'emitCritical',
      status: 'no_listeners',
      correlationId: 'corr-1',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z',
      limit: 10,
      cursor: 'cur-1',
    });

    expect(deliveries.listDeliveries).toHaveBeenCalledWith({
      eventName: 'invoice.sent',
      method: 'emitCritical',
      status: 'no_listeners',
      correlationId: 'corr-1',
      since: new Date('2026-01-01T00:00:00.000Z'),
      until: new Date('2026-02-01T00:00:00.000Z'),
      limit: 10,
      cursor: 'cur-1',
    });
  });

  it('getTrace overrides correlationId onto the base query', async () => {
    const { svc, deliveries } = service();
    await svc.getTrace('corr-9', { limit: 5 });

    expect(deliveries.listDeliveries).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-9', limit: 5 }));
  });

  it('deliveryCatalog delegates to the observability port', async () => {
    const { svc, deliveries } = service();
    await svc.deliveryCatalog();
    expect(deliveries.deliveryCatalog).toHaveBeenCalledTimes(1);
  });

  it('listListenerBindings delegates to the listener-catalog port', async () => {
    const { svc, listenerCatalog } = service();
    await svc.listListenerBindings();
    expect(listenerCatalog.list).toHaveBeenCalledTimes(1);
  });
});
