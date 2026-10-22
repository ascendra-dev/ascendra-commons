import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AuthorizationEnforcedGuard } from '../../authorization/authorization.core';
import { EVENT_DELIVERY_OBSERVABILITY_PORT, EVENT_LISTENER_CATALOG_PORT } from '../domain-events.core';
import { DomainEventsApiModule } from './domain-events-api.module';
import { DomainEventsController } from './domain-events.controller';

const listDeliveries = vi.fn().mockResolvedValue({ deliveries: [{ id: '1' }], nextCursor: 'next' });
const deliverySummary = vi.fn().mockResolvedValue({ total: 0 });
const deliveryCatalog = vi.fn().mockResolvedValue([]);
const volume = vi.fn().mockResolvedValue({ perDay: [] });
const listBindings = vi.fn().mockResolvedValue([]);

@Module({
  providers: [
    { provide: EVENT_DELIVERY_OBSERVABILITY_PORT, useValue: { listDeliveries, deliverySummary, deliveryCatalog, volume } },
    { provide: EVENT_LISTENER_CATALOG_PORT, useValue: { list: listBindings } },
  ],
  exports: [EVENT_DELIVERY_OBSERVABILITY_PORT, EVENT_LISTENER_CATALOG_PORT],
})
class FakePortsModule {}

describe('DomainEventsApiModule.forRoot — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [DomainEventsApiModule.forRoot({ imports: [FakePortsModule] })],
    }).compile();
  }

  it('resolves the controller', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(DomainEventsController)).toBeInstanceOf(DomainEventsController);
  });

  it('fails closed without the global AuthorizationGuard', () => {
    // A missing global AuthorizationGuard must be a 500, never every signed-in user reading the log.
    expect(Reflect.getMetadata(GUARDS_METADATA, DomainEventsController)).toContain(AuthorizationEnforcedGuard);
  });

  it('routes GET /domain-events/deliveries, answering api-contract Rule 4 { data, meta: { nextCursor } }', async () => {
    const moduleRef = await build();
    const body = await moduleRef.get(DomainEventsController).deliveries('invoice.sent');
    expect(listDeliveries).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'invoice.sent' }));
    expect(body).toEqual({ data: [{ id: '1' }], meta: { nextCursor: 'next' } });
  });

  it('routes GET /domain-events/deliveries/trace/:correlationId, forcing ascending order', async () => {
    const moduleRef = await build();
    const body = await moduleRef.get(DomainEventsController).trace('trace-9');
    expect(listDeliveries).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trace-9', order: 'asc' }));
    expect(body).toHaveProperty('data');
  });

  it('routes summary and catalog with a parsed since', async () => {
    const moduleRef = await build();
    const controller = moduleRef.get(DomainEventsController);
    await controller.summary('2026-10-21T00:00:00Z');
    await controller.deliveryCatalog('2026-10-21T00:00:00Z');
    expect(deliverySummary).toHaveBeenCalledWith({ since: new Date('2026-10-21T00:00:00Z') });
    expect(deliveryCatalog).toHaveBeenCalledWith({ since: new Date('2026-10-21T00:00:00Z') });
  });

  it('routes GET /domain-events/deliveries/volume with the time zone', async () => {
    const moduleRef = await build();
    await moduleRef.get(DomainEventsController).volume('Asia/Dubai');
    expect(volume).toHaveBeenCalledWith('Asia/Dubai');
  });

  it('routes GET /domain-events/listener-catalog', async () => {
    const moduleRef = await build();
    await moduleRef.get(DomainEventsController).listenerCatalog();
    expect(listBindings).toHaveBeenCalledTimes(1);
  });
});
