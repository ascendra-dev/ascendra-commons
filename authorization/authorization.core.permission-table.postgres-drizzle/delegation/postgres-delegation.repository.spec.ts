import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresDelegationRepository } from './postgres-delegation.repository';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function inDays(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function fakeDb(rows: (text: string) => unknown[]) {
  const execute = vi.fn(async (q: SQL) => ({ rows: rows(dialect.sqlToQuery(q).sql) }));
  return { execute } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

const INSERT_ROW = {
  id: 'd1',
  granter_id: 'granter',
  grantee_id: 'grantee',
  tenant_id: 't1',
  actions: ['invoice.void'],
  expires_at: inDays(7),
  revoked_at: null,
  reason: null,
  created_at: new Date(),
};

describe('PostgresDelegationRepository', () => {
  it('insert writes every column and maps the row to a DelegationRecord with derived status', async () => {
    const db = fakeDb((text) => (/INSERT INTO commons_authz_delegation/i.test(text) ? [INSERT_ROW] : []));
    const rec = await new PostgresDelegationRepository(db).insert({
      granterId: 'granter',
      granteeId: 'grantee',
      tenantId: 't1',
      actions: ['invoice.void'],
      expiresAt: inDays(7),
    });

    expect(rec).toMatchObject({ id: 'd1', status: 'active', reason: null });
    const { params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    // createdBy defaults to granterId
    expect(params).toEqual(expect.arrayContaining(['granter', 'grantee', 't1']));
  });

  it('revoke issues one conditional update', async () => {
    const db = fakeDb(() => []);
    await new PostgresDelegationRepository(db).revoke('d1', 'admin');

    const text = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql;
    expect(text).toMatch(/UPDATE commons_authz_delegation/i);
    expect(text).toMatch(/revoked_at IS NULL/i);
  });

  it('getById returns the mapped record when found, null otherwise', async () => {
    const found = fakeDb((text) => (/FROM commons_authz_delegation/i.test(text) ? [INSERT_ROW] : []));
    const rec = await new PostgresDelegationRepository(found).getById('d1');
    expect(rec).toMatchObject({ id: 'd1', tenantId: 't1' });
    const text = dialect.sqlToQuery(found.execute.mock.calls[0][0] as SQL).sql;
    expect(text).toMatch(/WHERE id = /i);

    const missing = fakeDb(() => []);
    await expect(new PostgresDelegationRepository(missing).getById('ghost')).resolves.toBeNull();
  });

  it('listForActor returns rows mapped to records', async () => {
    const rows = [
      { id: 'a', granter_id: 'u1', grantee_id: 'u2', tenant_id: 't1', actions: ['x'], expires_at: inDays(3), revoked_at: null, reason: null, created_at: new Date() },
      { id: 'b', granter_id: 'u3', grantee_id: 'u1', tenant_id: 't1', actions: ['y'], expires_at: inDays(-1), revoked_at: null, reason: null, created_at: new Date() },
    ];
    const db = fakeDb(() => rows);
    const records = await new PostgresDelegationRepository(db).listForActor('u1', 't1');

    expect(records.map((r) => r.id)).toEqual(['a', 'b']);
    expect(records[1].status).toBe('expired');
  });
});
