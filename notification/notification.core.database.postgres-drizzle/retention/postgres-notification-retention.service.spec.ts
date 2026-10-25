import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresNotificationRetentionService } from './postgres-notification-retention.service';
import { PostgresNotificationRetentionModule } from './postgres-notification-retention.module';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const ids = (n: number) => ({ rows: Array.from({ length: n }, (_, i) => ({ id: i })) });

function fakeDb(...batches: number[]) {
  const execute = vi.fn();
  for (const n of batches) execute.mockResolvedValueOnce(ids(n));
  return { execute } satisfies SqlExecutor as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}
const cutoff = new Date('2026-07-01T00:00:00Z');

describe('PostgresNotificationRetentionService', () => {
  it("pruneDeliveries deletes this application's rows before the cutoff, in batches, until a short batch", async () => {
    const db = fakeDb(2, 2, 1);
    await expect(new PostgresNotificationRetentionService(db, 'ascendra-pay').pruneDeliveries(cutoff, 2)).resolves.toBe(5);
    expect(db.execute).toHaveBeenCalledTimes(3);
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/delete from commons_notification_delivery/i);
    expect(text).toMatch(/application = \$1 and attempted_at < \$2/i);
    expect(params).toEqual(['ascendra-pay', cutoff, 2]);
  });

  it('clearContent empties only rows that still hold content — and keeps the rows', async () => {
    const db = fakeDb(1);
    await expect(new PostgresNotificationRetentionService(db, 'ascendra-pay').clearContent(cutoff)).resolves.toBe(1);
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/update commons_notification_delivery set content = null/i);
    expect(text).toMatch(/content is not null/i);
    expect(text).not.toMatch(/delete/i);
    expect(params).toEqual(['ascendra-pay', cutoff, 5_000]);
  });

  it('pruneDedupeKeys deletes keys whose window has passed', async () => {
    const db = fakeDb(3);
    const now = new Date('2026-07-02T00:00:00Z');
    await expect(new PostgresNotificationRetentionService(db, 'a').pruneDedupeKeys(now)).resolves.toBe(3);
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/delete from commons_notification_dedupe/i);
    expect(text).toMatch(/expires_at < \$2/i);
    expect(params).toEqual(['a', now, 5_000, 'a']);
  });

  it('pruneInbox deletes inbox items created before the cutoff', async () => {
    const db = fakeDb(1);
    await expect(new PostgresNotificationRetentionService(db, 'a').pruneInbox(cutoff)).resolves.toBe(1);
    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql).toMatch(/delete from commons_notification_inbox/i);
  });

  it('nothing to do is one query', async () => {
    const db = fakeDb(0);
    await expect(new PostgresNotificationRetentionService(db, 'a').pruneDeliveries(cutoff)).resolves.toBe(0);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('the module provides and exports the service', async () => {
    const DB = Symbol('DB');
    @Module({ providers: [{ provide: DB, useValue: fakeDb(0) }], exports: [DB] })
    class DbModule {}
    const ref = await Test.createTestingModule({
      imports: [PostgresNotificationRetentionModule.forRoot({ sqlExecutorToken: DB, application: 'a', imports: [DbModule] })],
    }).compile();
    expect(ref.get(PostgresNotificationRetentionService)).toBeInstanceOf(PostgresNotificationRetentionService);
  });
});
