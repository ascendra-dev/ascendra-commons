import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DomainEventsApiService } from './domain-events-api.service';
import {
  InvalidDeliveryCursorError,
  type EventDeliveryObservabilityPort,
  type EventListenerCatalogPort,
} from '../domain-events.core';

function service() {
  const deliveries: EventDeliveryObservabilityPort = {
    listDeliveries: vi.fn().mockResolvedValue({ deliveries: [] }),
    deliverySummary: vi.fn().mockResolvedValue({}),
    deliveryCatalog: vi.fn().mockResolvedValue([]),
    volume: vi.fn().mockResolvedValue({ perDay: [] }),
  };
  const listenerCatalog: EventListenerCatalogPort = { list: vi.fn().mockResolvedValue([]) };
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
      order: 'asc',
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
      order: 'asc',
    });
  });

  it("getTrace forces order: 'asc' and the correlation id, whatever the caller asked", async () => {
    const { svc, deliveries } = service();
    await svc.getTrace('corr-9', { order: 'desc', limit: 5 });
    expect(deliveries.listDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'corr-9', order: 'asc', limit: 5 }),
    );
  });

  it('summary and catalog take since as a Date, or none', async () => {
    const { svc, deliveries } = service();
    await svc.deliverySummary();
    await svc.deliveryCatalog('2026-10-21T00:00:00.000Z');
    expect(deliveries.deliverySummary).toHaveBeenCalledWith({ since: undefined });
    expect(deliveries.deliveryCatalog).toHaveBeenCalledWith({ since: new Date('2026-10-21T00:00:00.000Z') });
  });

  it('volume passes the time zone through', async () => {
    const { svc, deliveries } = service();
    await svc.volume('Asia/Karachi');
    expect(deliveries.volume).toHaveBeenCalledWith('Asia/Karachi');
  });

  it('listListenerBindings delegates to the listener-catalog port', async () => {
    const { svc, listenerCatalog } = service();
    await svc.listListenerBindings();
    expect(listenerCatalog.list).toHaveBeenCalledTimes(1);
  });

  describe('a caller mistake is a 400, never a 500', () => {
    it.each([
      ['since', { since: 'yesterday' }],
      ['until', { until: '2026-13-45' }],
      ['limit', { limit: Number.NaN }],
      ['limit', { limit: 0 }],
      ['method', { method: 'shout' }],
      ['status', { status: 'lost' }],
      ['order', { order: 'sideways' }],
      ['eventName', { eventName: 'a\u0000b' }],
      ['correlationId', { correlationId: '\u0000' }],
    ])('listDeliveries — bad %s', async (_name, dto) => {
      const { svc, deliveries } = service();
      await expect(svc.listDeliveries(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(deliveries.listDeliveries).not.toHaveBeenCalled();
    });

    it('a cursor the adapter never issued', async () => {
      const { svc, deliveries } = service();
      vi.mocked(deliveries.listDeliveries).mockRejectedValueOnce(new InvalidDeliveryCursorError('nope'));
      await expect(svc.listDeliveries({ cursor: 'garbage' })).rejects.toThrow(/"cursor" is not one this endpoint returned/);
    });

    it('summary / catalog dates and an unknown time zone', () => {
      const { svc } = service();
      expect(() => svc.deliverySummary('nope')).toThrow(BadRequestException);
      expect(() => svc.deliveryCatalog('nope')).toThrow(BadRequestException);
      expect(() => svc.volume('Mars/Olympus')).toThrow(/Unknown time zone/);
    });
  });
});
