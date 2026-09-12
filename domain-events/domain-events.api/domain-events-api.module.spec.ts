import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EVENT_DELIVERY_OBSERVABILITY_PORT, EVENT_LISTENER_CATALOG_PORT } from '../domain-events.core';
import { DomainEventsApiModule } from './domain-events-api.module';
import { DomainEventsController } from './domain-events.controller';

const listDeliveries = vi.fn().mockResolvedValue({ deliveries: [] });
const deliveryCatalog = vi.fn().mockResolvedValue([]);
const listBindings = vi.fn().mockResolvedValue([]);

@Module({
  providers: [
    { provide: EVENT_DELIVERY_OBSERVABILITY_PORT, useValue: { listDeliveries, deliveryCatalog } },
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

  it('routes GET /domain-events/deliveries through to the observability port', async () => {
    const moduleRef = await build();
    await moduleRef.get(DomainEventsController).deliveries('invoice.sent');
    expect(listDeliveries).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'invoice.sent' }));
  });

  it('routes GET /domain-events/deliveries/trace/:correlationId', async () => {
    const moduleRef = await build();
    await moduleRef.get(DomainEventsController).trace('trace-9');
    expect(listDeliveries).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trace-9' }));
  });

  it('routes GET /domain-events/deliveries/catalog', async () => {
    const moduleRef = await build();
    await moduleRef.get(DomainEventsController).deliveryCatalog();
    expect(deliveryCatalog).toHaveBeenCalledTimes(1);
  });

  it('routes GET /domain-events/listener-catalog', async () => {
    const moduleRef = await build();
    await moduleRef.get(DomainEventsController).listenerCatalog();
    expect(listBindings).toHaveBeenCalledTimes(1);
  });
});
