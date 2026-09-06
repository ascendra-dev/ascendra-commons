import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DeliveryAttempt } from '../../notification-delivery-recorder';
import { PostgresNotificationDeliveryRecorder } from './postgres-notification-delivery-recorder';
import type { SqlExecutor } from './sql-executor';

const dialect = new PgDialect();

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}
const rendered = (db: ReturnType<typeof fakeDb>) => dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);

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

const recorder = (db: SqlExecutor, application: string, storeContent = false) =>
  new PostgresNotificationDeliveryRecorder(db, application, storeContent);

describe('PostgresNotificationDeliveryRecorder', () => {
  it('batches all attempts into one insert, application stamped', async () => {
    const db = fakeDb();
    await recorder(db, 'ascendra-erp').recordAttempts([
      attempt({ channel: 'email', status: 'sent', providerMessageId: 'm1' }),
      attempt({ channel: 'sms', status: 'failed', reason: 'no_phone' }),
    ]);

    expect(db.execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/insert into commons_notification_delivery/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-erp', 'invoice.sent', 'email', 'sms', 'user:u1', 'm1', 'no_phone']));
  });

  it('with storeContent off (default), the content column is written NULL even when the attempt carries content', async () => {
    const db = fakeDb();
    await recorder(db, 'a').recordAttempts([
      attempt({ content: { subject: 's', body: 'b', isHtml: false, variables: { x: 1 } } }),
    ]);
    const { sql: text, params } = rendered(db);
    expect(text).not.toMatch(/::jsonb/i);
    expect(params).not.toContain(JSON.stringify({ subject: 's', body: 'b', isHtml: false, variables: { x: 1 } }));
  });

  it('with storeContent on, the rendered content is written as a jsonb param', async () => {
    const db = fakeDb();
    const content = { subject: 'Hi Sam', body: 'You owe 40', isHtml: false, variables: { name: 'Sam', amount: 40 } };
    await recorder(db, 'a', true).recordAttempts([attempt({ content })]);
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/::jsonb/i);
    expect(params).toContain(JSON.stringify(content));
  });

  it('no-ops on an empty attempt list', async () => {
    const db = fakeDb();
    await recorder(db, 'a').recordAttempts([]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('never propagates a write failure — best-effort by contract', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('constraint'));

    await expect(recorder(db, 'a').recordAttempts([attempt()])).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Failed to record'), expect.any(String));
  });

  it('updateDeliveryStatus matches on application + provider_message_id and coalesces the detail', async () => {
    const db = fakeDb();
    await recorder(db, 'ascendra-pay').updateDeliveryStatus({
      providerMessageId: 'ses-9',
      status: 'bounced',
      detail: 'mailbox full',
    });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/update commons_notification_delivery/i);
    expect(text).toMatch(/provider_message_id =/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-pay', 'ses-9', 'bounced', 'mailbox full']));
  });
});
