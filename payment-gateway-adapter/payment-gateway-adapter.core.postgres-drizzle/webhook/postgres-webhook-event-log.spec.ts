import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresWebhookEventLog } from './postgres-webhook-event-log';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn() } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

describe('PostgresWebhookEventLog.claim', () => {
  it('returns "applied" and records it when the claim insert wins (a fresh (gateway, reference, status))', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ gateway_reference: 'ref-1' }] }); // claim insert won
    db.execute.mockResolvedValueOnce({ rows: [] }); // event log insert

    const result = await new PostgresWebhookEventLog(db, 'ascendra-pay').claim('stripe', 'ref-1', 'succeeded', 'corr-1');

    expect(result).toBe('applied');
    expect(db.execute).toHaveBeenCalledTimes(2);
    const claimSql = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(claimSql.sql).toMatch(/insert into commons_payment_gateway_webhook_claim/i);
    expect(claimSql.sql).toMatch(/on conflict \(application, gateway, gateway_reference, status\) do nothing/i);
    const eventSql = dialect.sqlToQuery(db.execute.mock.calls[1][0] as SQL);
    expect(eventSql.sql).toMatch(/insert into commons_payment_gateway_webhook_event/i);
    expect(eventSql.params).toContain('applied');
  });

  it('returns "duplicate" and records it when the claim insert conflicts (already seen)', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO NOTHING — 0 rows
    db.execute.mockResolvedValueOnce({ rows: [] }); // event log insert

    const result = await new PostgresWebhookEventLog(db, 'ascendra-pay').claim('stripe', 'ref-1', 'succeeded');

    expect(result).toBe('duplicate');
    const eventSql = dialect.sqlToQuery(db.execute.mock.calls[1][0] as SQL);
    expect(eventSql.params).toContain('duplicate');
  });

  it('still returns its own result even if recording the observability event fails', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ gateway_reference: 'ref-1' }] });
    db.execute.mockRejectedValueOnce(new Error('log down'));
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(new PostgresWebhookEventLog(db, 'ascendra-pay').claim('stripe', 'ref-1', 'succeeded')).resolves.toBe(
      'applied',
    );
  });
});

describe('PostgresWebhookEventLog.recordRejectedEvent', () => {
  it('inserts an ignored_backwards event with the given gateway/reference/status', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });

    await new PostgresWebhookEventLog(db, 'ascendra-pay').recordRejectedEvent({
      gateway: 'stripe',
      gatewayReference: 'ref-2',
      status: 'pending',
      outcome: 'ignored_backwards',
    });

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/insert into commons_payment_gateway_webhook_event/i);
    expect(params).toEqual(expect.arrayContaining(['stripe', 'ref-2', 'pending', 'ignored_backwards']));
  });

  it('inserts a signature_invalid event with a null reference/status', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });

    await new PostgresWebhookEventLog(db, 'ascendra-pay').recordRejectedEvent({
      gateway: 'stripe',
      gatewayReference: null,
      status: null,
      outcome: 'signature_invalid',
    });

    const { params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(params).not.toContain('null');
    expect(params).toContain('signature_invalid');
  });

  it('never throws when the insert fails', async () => {
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('connection reset'));
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      new PostgresWebhookEventLog(db, 'ascendra-pay').recordRejectedEvent({
        gateway: 'stripe',
        gatewayReference: null,
        status: null,
        outcome: 'signature_invalid',
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
