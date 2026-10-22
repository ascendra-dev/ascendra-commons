import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { getTableColumns, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { EventDeliveryAttempt } from '../../domain-events.core';
import { domainEventDeliveryTable } from '../persistence/domain-event-delivery.schema';
import { PostgresEventDeliveryRecorder, type PostgresEventDeliveryRecorderOptions } from './postgres-event-delivery-recorder';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>, call = 0) {
  return dialect.sqlToQuery(db.execute.mock.calls[call][0] as SQL);
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

const recorders: PostgresEventDeliveryRecorder[] = [];
function recorder(db: SqlExecutor, application = 'ascendra-pay', options?: PostgresEventDeliveryRecorderOptions) {
  const r = new PostgresEventDeliveryRecorder(db, application, options);
  recorders.push(r);
  return r;
}

afterEach(async () => {
  // Stop each recorder's interval; the fake db absorbs the final flush.
  for (const r of recorders.splice(0)) await r.onModuleDestroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PostgresEventDeliveryRecorder', () => {
  it('does no I/O when a delivery is recorded — only on flush', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordDelivery(attempt());
    await r.recordDelivery(attempt({ eventName: 'invoice.paid' }));
    expect(db.execute).not.toHaveBeenCalled();

    await r.flush();
    expect(db.execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/insert into commons_domain_events_delivery/i);
    expect(params).toEqual(expect.arrayContaining(['invoice.sent', 'invoice.paid']));
  });

  it('flushes on its interval', async () => {
    vi.useFakeTimers();
    const db = fakeDb();
    const r = recorder(db, 'ascendra-pay', { flushIntervalMs: 1_000 });
    await r.recordDelivery(attempt());

    await vi.advanceTimersByTimeAsync(1_000);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('a flush with nothing buffered writes nothing', async () => {
    const db = fakeDb();
    await recorder(db).flush();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('stamps the injected application, not anything off the attempt', async () => {
    const db = fakeDb();
    const r = recorder(db, 'ascendra-erp');
    await r.recordDelivery(attempt());
    await r.flush();

    expect(rendered(db).params).toContain('ascendra-erp');
  });

  it('writes every column the schema defines except the db-assigned id — guards against schema/INSERT drift', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordDelivery(attempt());
    await r.flush();

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
    const r = recorder(db);
    await r.recordDelivery(attempt());
    await r.flush();

    expect(rendered(db).params).not.toContain('null');
  });

  it('writes reason and a well-formed correlationId when present', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordDelivery(attempt({ status: 'dispatch_failed', reason: 'boom', correlationId: 'corr-1' }));
    await r.flush();

    const { params } = rendered(db);
    expect(params).toContain('boom');
    expect(params).toContain('corr-1');
  });

  it('drops a malformed correlation id rather than recording caller-controlled junk', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordDelivery(attempt({ correlationId: '<script>alert(1)</script>' }));
    await r.recordDelivery(attempt({ correlationId: 'x'.repeat(129) }));
    await r.flush();

    const { params } = rendered(db);
    expect(params).not.toContain('<script>alert(1)</script>');
    expect(params).not.toContain('x'.repeat(129));
  });

  it('writes in chunks of 1,000 rows — under the 65,535-parameter cap', async () => {
    const db = fakeDb();
    const r = recorder(db, 'ascendra-pay', { maxBufferedRows: 5_000 });
    for (let i = 0; i < 2_500; i++) await r.recordDelivery(attempt());
    await r.flush();

    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('past maxBufferedRows, drops further deliveries and logs how many at the next flush', async () => {
    const db = fakeDb();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const r = recorder(db, 'ascendra-pay', { maxBufferedRows: 2 });
    for (let i = 0; i < 5; i++) await r.recordDelivery(attempt({ eventName: `e${i}` }));
    await r.flush();

    expect(rendered(db).params).toEqual(expect.arrayContaining(['e0', 'e1']));
    expect(rendered(db).params).not.toContain('e2');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^3 event delivery\(ies\) not recorded/));
  });

  it('never throws when the insert fails — logged with how many were lost, the buffer cleared', async () => {
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('connection reset'));
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const r = recorder(db);
    await r.recordDelivery(attempt());
    await r.recordDelivery(attempt());

    await expect(r.flush()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Failed to record 2 event delivery/), expect.anything());

    await r.flush();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('flushes what is buffered on shutdown', async () => {
    const db = fakeDb();
    const r = new PostgresEventDeliveryRecorder(db, 'ascendra-pay');
    await r.recordDelivery(attempt());
    await r.onModuleDestroy();

    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
