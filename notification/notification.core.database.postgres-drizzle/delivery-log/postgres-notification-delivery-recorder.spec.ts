import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DeliveryAttempt } from '../../notification.core';
import { PostgresNotificationDeliveryRecorder, type PostgresNotificationDeliveryRecorderOptions } from './postgres-notification-delivery-recorder';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const made: PostgresNotificationDeliveryRecorder[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const r of made.splice(0)) await r.onModuleDestroy();
});

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}
const query = (db: ReturnType<typeof fakeDb>, i = 0) => dialect.sqlToQuery(db.execute.mock.calls[i][0] as SQL);

function attempt(over: Partial<DeliveryAttempt> = {}): DeliveryAttempt {
  return {
    notificationType: 'invoice.sent',
    channel: 'email',
    tenantId: 't1',
    recipientRef: 'user:u1',
    status: 'sent',
    attemptedAt: new Date('2026-06-01T08:00:00Z'),
    ...over,
  };
}

function recorder(db: SqlExecutor, application = 'a', storeContent = false, options: PostgresNotificationDeliveryRecorderOptions = {}) {
  const r = new PostgresNotificationDeliveryRecorder(db, application, storeContent, options);
  made.push(r);
  return r;
}

/** Record, then write the buffer — what the timer does. */
async function recordAndFlush(r: PostgresNotificationDeliveryRecorder, attempts: DeliveryAttempt[]) {
  await r.recordAttempts(attempts);
  await r.flush();
}

describe('PostgresNotificationDeliveryRecorder — buffered', () => {
  it('a send never waits on the database: recordAttempts only buffers', async () => {
    const db = fakeDb();
    await recorder(db).recordAttempts([attempt(), attempt({ channel: 'sms' })]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('a flush writes every buffered row — several sends — in one insert, application stamped', async () => {
    const db = fakeDb();
    const r = recorder(db, 'ascendra-erp');
    await r.recordAttempts([attempt({ channel: 'email', providerMessageId: 'm1' })]);
    await r.recordAttempts([attempt({ channel: 'sms', status: 'failed', reason: 'no_phone' })]);
    await r.flush();
    expect(db.execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = query(db);
    expect(text).toMatch(/insert into commons_notification_delivery/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-erp', 'invoice.sent', 'email', 'sms', 'user:u1', 'm1', 'no_phone']));
  });

  it('the timer writes it — every flushIntervalMs', async () => {
    vi.useFakeTimers();
    const db = fakeDb();
    await recorder(db, 'a', false, { flushIntervalMs: 2_000 }).recordAttempts([attempt()]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(db.execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('a full batch is written at once, in inserts of at most 1,000 rows', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordAttempts(Array.from({ length: 2_500 }, () => attempt()));
    await r.flush();
    expect(db.execute).toHaveBeenCalledTimes(3);
    expect(query(db, 0).params.filter((p) => p === 'invoice.sent')).toHaveLength(1_000);
    expect(query(db, 2).params.filter((p) => p === 'invoice.sent')).toHaveLength(500);
  });

  it('is written on shutdown', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordAttempts([attempt()]);
    await r.onModuleDestroy();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('no-ops on an empty buffer', async () => {
    const db = fakeDb();
    await recordAndFlush(recorder(db), []);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('PostgresNotificationDeliveryRecorder — each row normalized as it is buffered', () => {
  it('no NUL, bounded text, a valid date, a well-formed correlation id or none', async () => {
    const db = fakeDb();
    await recordAndFlush(recorder(db), [
      attempt({ reason: 'smtp\u0000 550', attemptedAt: new Date('nope'), correlationId: 'has spaces', notificationType: 'x'.repeat(300) }),
    ]);
    const { params } = query(db);
    expect(params).toContain('smtp 550');
    expect(params).toContain('x'.repeat(256));
    expect(params.some((p) => typeof p === 'string' && p.includes('\u0000'))).toBe(false);
    const dates = params.filter((p) => p instanceof Date) as Date[];
    expect(dates.every((d) => !Number.isNaN(d.getTime()))).toBe(true);
    expect(params).not.toContain('has spaces');
  });

  it('writes recipient_key — a user or a hashed address, never the address', async () => {
    const db = fakeDb();
    await recordAndFlush(recorder(db), [attempt({ recipientKey: 'h:abc' }), attempt({ recipientKey: null })]);
    const { sql: text, params } = query(db);
    expect(text).toMatch(/recipient_ref, recipient_key, status/i);
    expect(params).toContain('h:abc');
  });

  it('writes retry_of as a bigint — or NULL for a first send (or a malformed id)', async () => {
    const db = fakeDb();
    await recordAndFlush(recorder(db), [attempt({ retryOf: '41' }), attempt(), attempt({ retryOf: 'x41' })]);
    const { sql: text, params } = query(db);
    expect(text).toMatch(/is_test, retry_of\)/i);
    expect(text).toMatch(/\$\d+::bigint/i);
    expect(params).toContain('41');
    expect(params).not.toContain('x41');
  });

  it('writes is_test — a test send is marked, a real one (or one that says nothing) is not', async () => {
    const db = fakeDb();
    await recordAndFlush(recorder(db), [attempt({ test: true }), attempt()]);
    const { sql: text, params } = query(db);
    expect(text).toMatch(/content, is_test, retry_of\)/i);
    expect(params.filter((p) => typeof p === 'boolean')).toEqual([true, false]);
  });

  it('with storeContent off (default), content is written NULL even when the attempt carries it', async () => {
    const db = fakeDb();
    await recordAndFlush(recorder(db), [attempt({ content: { subject: 's', body: 'b', isHtml: false, variables: { x: 1 } } })]);
    const { sql: text, params } = query(db);
    expect(text).not.toMatch(/::jsonb/i);
    expect(params).not.toContain(JSON.stringify({ subject: 's', body: 'b', isHtml: false, variables: { x: 1 } }));
  });

  it('with storeContent on, the content is a jsonb param — without the \\u0000 escape jsonb rejects', async () => {
    const db = fakeDb();
    const content = { subject: 'Hi Sam', body: 'You owe\u0000 40', isHtml: false, variables: { name: 'Sam', amount: 40 } };
    await recordAndFlush(recorder(db, 'a', true), [attempt({ content })]);
    const { sql: text, params } = query(db);
    expect(text).toMatch(/::jsonb/i);
    expect(params).toContain(JSON.stringify({ ...content, body: 'You owe 40' }));
  });
});

describe('PostgresNotificationDeliveryRecorder — best-effort', () => {
  it('a failed write is logged with how many rows it lost — never thrown; the next write still goes', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('connection lost'));
    const r = recorder(db);
    await expect(recordAndFlush(r, [attempt(), attempt()])).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Failed to record 2'), expect.any(String));
    await recordAndFlush(r, [attempt()]);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('bounded: past maxBufferedRows the oldest are dropped, and the next write says how many', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const db = fakeDb();
    let release!: () => void;
    db.execute.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ rows: [] })))); // a slow database
    const r = recorder(db, 'a', false, { maxBufferedRows: 1_000 });
    await r.recordAttempts(Array.from({ length: 1_000 }, () => attempt({ notificationType: 'first' }))); // its write hangs
    await r.recordAttempts(Array.from({ length: 1_000 }, () => attempt({ notificationType: 'old' })));
    await r.recordAttempts(Array.from({ length: 10 }, () => attempt({ notificationType: 'new' })));
    release();
    await r.flush();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Dropped 10'));
    const written = db.execute.mock.calls.slice(1).flatMap((c) => dialect.sqlToQuery(c[0] as SQL).params);
    expect(written.filter((p) => p === 'new')).toHaveLength(10);
    expect(written.filter((p) => p === 'old')).toHaveLength(990);
  });
});

describe('PostgresNotificationDeliveryRecorder — provider webhook', () => {
  it('updateDeliveryStatus writes the buffer first — a fast callback never misses its row — then updates', async () => {
    const db = fakeDb();
    const r = recorder(db, 'ascendra-pay');
    await r.recordAttempts([attempt({ providerMessageId: 'ses-9' })]);
    await r.updateDeliveryStatus({ providerMessageId: 'ses-9', status: 'bounced', detail: 'mailbox full' });
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(query(db, 0).sql).toMatch(/insert into commons_notification_delivery/i);
    const { sql: text, params } = query(db, 1);
    expect(text).toMatch(/update commons_notification_delivery/i);
    expect(text).toMatch(/provider_message_id =/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-pay', 'ses-9', 'bounced', 'mailbox full']));
  });
});

describe('PostgresNotificationDeliveryRecorder — suppression', () => {
  it("a hard bounce (suppress: true) files the delivery's recipient key — keyed rows only; a repeat counts", async () => {
    const db = fakeDb();
    await recorder(db, 'ascendra-pay').updateDeliveryStatus({ providerMessageId: 'ses-9', status: 'bounced', detail: '550', suppress: true });
    const { sql: text, params } = query(db, 1);
    expect(text).toMatch(/insert into commons_notification_suppression/i);
    expect(text).toMatch(/d\.recipient_key is not null/i);
    expect(text).toMatch(/on conflict on constraint commons_notification_suppression_uq do update set/i);
    expect(text).toMatch(/event_count = s\.event_count \+ 1/i);
    expect(params).toEqual(expect.arrayContaining(['bounced', '550', 'ascendra-pay', 'ses-9']));
  });

  it('a soft bounce suppresses nothing', async () => {
    const db = fakeDb();
    await recorder(db).updateDeliveryStatus({ providerMessageId: 'ses-9', status: 'bounced' });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('a skipped attempt is recorded as skipped', async () => {
    const db = fakeDb();
    await recordAndFlush(recorder(db), [attempt({ status: 'skipped', reason: 'suppressed' })]);
    expect(query(db).params).toEqual(expect.arrayContaining(['skipped', 'suppressed']));
  });
});
