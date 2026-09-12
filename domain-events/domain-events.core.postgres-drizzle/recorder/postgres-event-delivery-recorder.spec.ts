import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { getTableColumns, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { EventDeliveryAttempt } from '../../domain-events.core';
import { domainEventDeliveryTable } from '../persistence/domain-event-delivery.schema';
import { PostgresEventDeliveryRecorder } from './postgres-event-delivery-recorder';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>) {
  return dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
}

function attempt(overrides: Partial<EventDeliveryAttempt> = {}): EventDeliveryAttempt {
  return {
    eventName: 'invoice.sent',
    method: 'emit',
    transport: 'in-process',
    occurredAt: new Date('2026-01-03T10:00:00Z'),
    listenerCount: 2,
    status: 'delivered',
    ...overrides,
  };
}

describe('PostgresEventDeliveryRecorder', () => {
  it('issues exactly one insert statement', async () => {
    const db = fakeDb();
    await new PostgresEventDeliveryRecorder(db, 'ascendra-pay').recordDelivery(attempt());

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(rendered(db).sql).toMatch(/insert into commons_domain_events_delivery/i);
  });

  it('stamps the injected application, not anything off the attempt', async () => {
    const db = fakeDb();
    await new PostgresEventDeliveryRecorder(db, 'ascendra-erp').recordDelivery(attempt());

    expect(rendered(db).params).toContain('ascendra-erp');
  });

  it('writes every column the schema defines except the db-assigned id — guards against schema/INSERT drift', async () => {
    const db = fakeDb();
    await new PostgresEventDeliveryRecorder(db, 'ascendra-pay').recordDelivery(attempt());

    const { sql: text } = rendered(db);
    const expected = Object.values(getTableColumns(domainEventDeliveryTable))
      .map((c) => (c as { name: string }).name)
      .filter((name) => name !== 'id');
    for (const column of expected) {
      expect(text).toContain(column);
    }
  });

  it('writes a null reason/correlationId as a real SQL NULL, not the string "null"', async () => {
    const db = fakeDb();
    await new PostgresEventDeliveryRecorder(db, 'ascendra-pay').recordDelivery(attempt());

    expect(rendered(db).params).not.toContain('null');
  });

  it('writes reason and correlationId when present', async () => {
    const db = fakeDb();
    await new PostgresEventDeliveryRecorder(db, 'ascendra-pay').recordDelivery(
      attempt({ status: 'dispatch_failed', reason: 'boom', correlationId: 'corr-1' }),
    );

    const { params } = rendered(db);
    expect(params).toContain('boom');
    expect(params).toContain('corr-1');
  });

  it('never throws when the insert fails — logged and swallowed (belt-and-braces on top of the emitter\'s own guard)', async () => {
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('connection reset'));
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(new PostgresEventDeliveryRecorder(db, 'ascendra-pay').recordDelivery(attempt())).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
