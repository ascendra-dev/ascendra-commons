import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { EVENT_DELIVERY_RECORDER } from '../../domain-events.core';
import type { PostgresEventDeliveryRecorder } from './postgres-event-delivery-recorder';
import { PostgresEventDeliveryRecorderModule } from './postgres-event-delivery-recorder.module';
import { POSTGRES_EVENT_DELIVERY_RECORDER } from '../tokens';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresEventDeliveryRecorderModule', () => {
  it('resolves POSTGRES_EVENT_DELIVERY_RECORDER wired to the db token and application', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresEventDeliveryRecorderModule.forRoot({
          sqlExecutorToken: DB,
          application: 'ascendra-erp',
          maxBufferedRows: 1,
          imports: [DbModule],
        }),
      ],
    }).compile();

    const recorder = moduleRef.get<PostgresEventDeliveryRecorder>(POSTGRES_EVENT_DELIVERY_RECORDER);
    await recorder.recordDelivery({
      eventName: 'invoice.sent',
      method: 'emit',
      transport: 'in-process',
      occurredAt: new Date(),
      listenerCount: 1,
      status: 'delivered',
    });
    expect(execute).not.toHaveBeenCalled(); // buffered — written on flush
    await moduleRef.close(); // onModuleDestroy flushes

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/insert into commons_domain_events_delivery/i);
    expect(params).toContain('ascendra-erp');
  });

  it('is wired to the core EVENT_DELIVERY_RECORDER token by InProcessDomainEventEmitterModule.forRoot({ recorderToken })', () => {
    // Structural check: POSTGRES_EVENT_DELIVERY_RECORDER and EVENT_DELIVERY_RECORDER
    // are deliberately different tokens — this one is exported so a consumer can
    // pass it as `recorderToken`, which then gets useExisting-aliased to the core
    // EVENT_DELIVERY_RECORDER token inside InProcessDomainEventEmitterModule (see
    // that module's own spec for the end-to-end wiring assertion).
    expect(POSTGRES_EVENT_DELIVERY_RECORDER).not.toBe(EVENT_DELIVERY_RECORDER);
  });
});
