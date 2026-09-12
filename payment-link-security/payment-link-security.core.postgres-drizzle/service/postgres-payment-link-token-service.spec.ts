import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { TokenResolutionAttempt, TokenResolutionRecorder } from '../../payment-link-security.core';
import { PostgresPaymentLinkTokenService } from './postgres-payment-link-token-service';
import { hashToken } from '../hash-token';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn() } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

function rendered(db: ReturnType<typeof fakeDb>, call = 0) {
  return dialect.sqlToQuery(db.execute.mock.calls[call][0] as SQL);
}

function fakeRecorder() {
  const attempts: Array<[string, TokenResolutionAttempt]> = [];
  const recorder: TokenResolutionRecorder = {
    recordAttempt: vi.fn(async (token, attempt) => {
      attempts.push([token, attempt]);
    }),
  };
  return { recorder, attempts };
}

describe('PostgresPaymentLinkTokenService.generate', () => {
  it('inserts a hashed token, never the raw value, and returns the raw token to the caller', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });

    const { token } = await new PostgresPaymentLinkTokenService(db, 'ascendra-pay').generate('inv-1', 'payer-1');

    expect(token).toMatch(/^[\w-]{40,}$/); // base64url, high entropy
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/insert into commons_payment_link_token/i);
    expect(params).toContain(hashToken(token));
    expect(params).not.toContain(token); // the raw token itself is never a bound param
  });

  it('generates a different token on every call', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValue({ rows: [] });
    const svc = new PostgresPaymentLinkTokenService(db, 'ascendra-pay');

    const a = await svc.generate('inv-1', 'payer-1');
    const b = await svc.generate('inv-1', 'payer-1');
    expect(a.token).not.toBe(b.token);
  });
});

describe('PostgresPaymentLinkTokenService.resolve', () => {
  it('returns the resource/subject pair for a valid, unrevoked token, and records "resolved"', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ resource_id: 'inv-1', subject_id: 'payer-1', revoked_at: null }] });
    const { recorder, attempts } = fakeRecorder();

    const result = await new PostgresPaymentLinkTokenService(db, 'ascendra-pay', recorder).resolve('tok-1', 'corr-1');

    expect(result).toEqual({ resourceId: 'inv-1', subjectId: 'payer-1' });
    expect(attempts).toEqual([['tok-1', { outcome: 'resolved', correlationId: 'corr-1' }]]);
  });

  it('returns null and records "not_found" when no row matches', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });
    const { recorder, attempts } = fakeRecorder();

    await expect(new PostgresPaymentLinkTokenService(db, 'ascendra-pay', recorder).resolve('tok-1')).resolves.toBeNull();
    expect(attempts).toEqual([['tok-1', { outcome: 'not_found', correlationId: undefined }]]);
  });

  it('returns null and records "revoked" — indistinguishable from not_found to the caller', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({
      rows: [{ resource_id: 'inv-1', subject_id: 'payer-1', revoked_at: new Date('2026-01-01') }],
    });
    const { recorder, attempts } = fakeRecorder();

    await expect(new PostgresPaymentLinkTokenService(db, 'ascendra-pay', recorder).resolve('tok-1')).resolves.toBeNull();
    expect(attempts).toEqual([['tok-1', { outcome: 'revoked', correlationId: undefined }]]);
  });

  it('looks up by the hashed token, never the raw value', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });
    await new PostgresPaymentLinkTokenService(db, 'ascendra-pay').resolve('raw-token-value');

    const { params } = rendered(db);
    expect(params).toContain(hashToken('raw-token-value'));
    expect(params).not.toContain('raw-token-value');
  });

  it('a recorder failure is swallowed — resolve() still returns its own result', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ resource_id: 'inv-1', subject_id: 'payer-1', revoked_at: null }] });
    const throwingRecorder: TokenResolutionRecorder = { recordAttempt: () => Promise.reject(new Error('log down')) };

    await expect(
      new PostgresPaymentLinkTokenService(db, 'ascendra-pay', throwingRecorder).resolve('tok-1'),
    ).resolves.toEqual({ resourceId: 'inv-1', subjectId: 'payer-1' });
  });

  it('defaults to a no-op recorder when none is injected', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });
    await expect(new PostgresPaymentLinkTokenService(db, 'ascendra-pay').resolve('tok-1')).resolves.toBeNull();
  });
});

describe('PostgresPaymentLinkTokenService.revoke', () => {
  it('updates guarded by application + resourceId + not-already-revoked', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });
    await new PostgresPaymentLinkTokenService(db, 'ascendra-pay').revoke('inv-1');

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/update commons_payment_link_token/i);
    expect(text).toMatch(/revoked_at is null/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-pay', 'inv-1']));
  });
});
