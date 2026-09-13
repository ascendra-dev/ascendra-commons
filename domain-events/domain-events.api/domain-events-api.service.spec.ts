import { describe, expect, it, vi } from 'vitest';
import { DomainEventsApiService, parseStatsWindow } from './domain-events-api.service';
import type { EventDeliveryObservabilityPort, EventListenerCatalogPort } from '../domain-events.core';

function service() {
  const deliveries: EventDeliveryObservabilityPort = {
    listDeliveries: vi.fn().mockResolvedValue({ deliveries: [] }),
    deliveryCatalog: vi.fn().mockResolvedValue([]),
    deliveryStats: vi.fn().mockResolvedValue({ perDay: [], topEvents: [], noListenerRate: 0, dispatchFailedRate: 0 }),
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

  it('getTrace overrides correlationId onto the base query and always requests ascending order', async () => {
    const { svc, deliveries } = service();
    await svc.getTrace('corr-9', { limit: 5 });

    expect(deliveries.listDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'corr-9', limit: 5, order: 'asc' }),
    );
  });

  it("getTrace forces order: 'asc' even if the caller's query asked for desc", async () => {
    const { svc, deliveries } = service();
    await svc.getTrace('corr-9', { order: 'desc' } as never);

    expect(deliveries.listDeliveries).toHaveBeenCalledWith(expect.objectContaining({ order: 'asc' }));
  });

  it('listDeliveries defaults to no explicit order (the port defaults to desc) but forwards an explicit one', async () => {
    const { svc, deliveries } = service();
    await svc.listDeliveries({});
    expect(deliveries.listDeliveries).toHaveBeenCalledWith(expect.objectContaining({ order: undefined }));

    await svc.listDeliveries({ order: 'asc' });
    expect(deliveries.listDeliveries).toHaveBeenLastCalledWith(expect.objectContaining({ order: 'asc' }));
  });

  it('deliveryCatalog delegates to the observability port', async () => {
    const { svc, deliveries } = service();
    await svc.deliveryCatalog();
    expect(deliveries.deliveryCatalog).toHaveBeenCalledTimes(1);
  });

  it('deliveryStats parses the window and delegates to the observability port', async () => {
    const { svc, deliveries } = service();
    await svc.deliveryStats('30d');

    expect(deliveries.deliveryStats).toHaveBeenCalledTimes(1);
    expect((deliveries.deliveryStats as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Date);
  });

  it('listListenerBindings delegates to the listener-catalog port', async () => {
    const { svc, listenerCatalog } = service();
    await svc.listListenerBindings();
    expect(listenerCatalog.list).toHaveBeenCalledTimes(1);
  });
});

describe('parseStatsWindow', () => {
  const now = new Date('2026-06-08T00:00:00.000Z');

  it('defaults to a 7-day window when no value is given', () => {
    expect(parseStatsWindow(undefined, now)).toEqual(new Date('2026-06-01T00:00:00.000Z'));
  });

  it('parses a day window', () => {
    expect(parseStatsWindow('30d', now)).toEqual(new Date('2026-05-09T00:00:00.000Z'));
  });

  it('parses an hour window', () => {
    expect(parseStatsWindow('24h', now)).toEqual(new Date('2026-06-07T00:00:00.000Z'));
  });

  it('falls back to the 7-day default for a malformed value', () => {
    expect(parseStatsWindow('garbage', now)).toEqual(new Date('2026-06-01T00:00:00.000Z'));
  });
});
