import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { EventDeliveryObservabilityPort } from '../../domain-events.core';
import { EVENT_DELIVERY_OBSERVABILITY_PORT } from '../../domain-events.core';
import { PostgresEventDeliveryObservabilityModule } from './postgres-event-delivery-observability.module';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresEventDeliveryObservabilityModule', () => {
  it('resolves EVENT_DELIVERY_OBSERVABILITY_PORT wired to the db token and application', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresEventDeliveryObservabilityModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] }),
      ],
    }).compile();

    const port = moduleRef.get<EventDeliveryObservabilityPort>(EVENT_DELIVERY_OBSERVABILITY_PORT);
    await port.listDeliveries({ eventName: 'invoice.sent' });

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/from commons_domain_events_delivery/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-erp', 'invoice.sent']));
  });
});
