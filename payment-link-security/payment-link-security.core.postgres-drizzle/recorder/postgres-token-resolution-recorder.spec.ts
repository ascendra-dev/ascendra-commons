import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresTokenResolutionRecorder } from './postgres-token-resolution-recorder';
import { hashToken } from '../hash-token';
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

describe('PostgresTokenResolutionRecorder', () => {
  it('inserts the hashed token, never the raw value', async () => {
    const db = fakeDb();
    await new PostgresTokenResolutionRecorder(db, 'ascendra-pay').recordAttempt('raw-token', { outcome: 'not_found' });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/insert into commons_payment_link_resolution/i);
    expect(params).toContain(hashToken('raw-token'));
    expect(params).not.toContain('raw-token');
  });

  it('stamps application and correlationId', async () => {
    const db = fakeDb();
    await new PostgresTokenResolutionRecorder(db, 'ascendra-erp').recordAttempt('t', {
      outcome: 'resolved',
      correlationId: 'corr-1',
    });

    expect(rendered(db).params).toEqual(expect.arrayContaining(['ascendra-erp', 'resolved', 'corr-1']));
  });

  it('never throws when the insert fails — logged and swallowed', async () => {
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('connection reset'));
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      new PostgresTokenResolutionRecorder(db, 'ascendra-pay').recordAttempt('t', { outcome: 'not_found' }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
