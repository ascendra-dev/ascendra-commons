import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Actor } from '../../authorization.types';
import {
  CannotDelegateError,
  DelegationService,
  InvalidDelegationExpiryError,
} from './delegation.service';
import type { PermissionLoader, ResolvedPermissions } from './permission-loader';
import type { SqlExecutor } from './sql-executor';

const dialect = new PgDialect();
const OPTIONS = { maxDelegationDays: 90 };

function inDays(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function fakeDb(insertReturn: Record<string, unknown> = {}) {
  const execute = vi.fn(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    if (text.includes('INSERT INTO authz_delegation')) {
      return {
        rows: [
          {
            id: 'd1',
            granter_id: 'granter',
            grantee_id: 'grantee',
            tenant_id: 't1',
            actions: ['invoice.void'],
            expires_at: inDays(7),
            revoked_at: null,
            reason: null,
            created_at: new Date(),
            ...insertReturn,
          },
        ],
      };
    }
    return { rows: [] };
  });
  return { execute } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

function fakeLoader(rolePerms: ResolvedPermissions): PermissionLoader {
  return { rolePermissions: async () => rolePerms } as unknown as PermissionLoader;
}

const granterHolds = (...actions: string[]): PermissionLoader =>
  fakeLoader({ grantsAll: false, actions: new Set(actions) });

describe('DelegationService.delegate', () => {
  it('creates a delegation when the granter holds every action from their roles', async () => {
    const db = fakeDb();
    const svc = new DelegationService(db, OPTIONS, granterHolds('invoice.void', 'invoice.view'));

    const rec = await svc.delegate({
      granterId: 'granter',
      granteeId: 'grantee',
      tenantId: 't1',
      actions: ['invoice.void'],
      expiresAt: inDays(7),
    });

    expect(rec.id).toBe('d1');
    expect(rec.status).toBe('active');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects actions the granter does not hold from roles', async () => {
    const svc = new DelegationService(fakeDb(), OPTIONS, granterHolds('invoice.view'));

    await expect(
      svc.delegate({
        granterId: 'granter',
        granteeId: 'grantee',
        tenantId: 't1',
        actions: ['invoice.view', 'payment.refund'],
        expiresAt: inDays(7),
      }),
    ).rejects.toBeInstanceOf(CannotDelegateError);
  });

  it('blocks chains: only role-derived permissions count, never delegated-in ones', async () => {
    // The loader used here is rolePermissions only — a delegated-in action would
    // simply not appear, so it can't be re-delegated. Proven by the rejection above;
    // this asserts the service never consults effectivePermissions.
    const loader = { rolePermissions: vi.fn(async () => ({ grantsAll: false, actions: new Set(['a']) })) };
    const svc = new DelegationService(fakeDb(), OPTIONS, loader as unknown as PermissionLoader);

    await svc.delegate({ granterId: 'g', granteeId: 'e', tenantId: 't', actions: ['a'], expiresAt: inDays(1) });

    expect(loader.rolePermissions).toHaveBeenCalledOnce();
  });

  it('a grants_all granter may delegate anything', async () => {
    const db = fakeDb();
    const svc = new DelegationService(db, OPTIONS, fakeLoader({ grantsAll: true, actions: new Set() }));

    await expect(
      svc.delegate({ granterId: 'g', granteeId: 'e', tenantId: 't1', actions: ['x.y'], expiresAt: inDays(1) }),
    ).resolves.toMatchObject({ id: 'd1' });
  });

  it('rejects a missing / past / too-far expiry', async () => {
    const svc = new DelegationService(fakeDb(), OPTIONS, granterHolds('a'));
    const base = { granterId: 'g', granteeId: 'e', tenantId: 't1', actions: ['a'] };

    await expect(svc.delegate({ ...base, expiresAt: new Date('invalid') })).rejects.toBeInstanceOf(
      InvalidDelegationExpiryError,
    );
    await expect(svc.delegate({ ...base, expiresAt: inDays(-1) })).rejects.toBeInstanceOf(InvalidDelegationExpiryError);
    await expect(svc.delegate({ ...base, expiresAt: inDays(120) })).rejects.toBeInstanceOf(InvalidDelegationExpiryError);
  });

  it('rejects an empty action list', async () => {
    const svc = new DelegationService(fakeDb(), OPTIONS, granterHolds('a'));
    await expect(
      svc.delegate({ granterId: 'g', granteeId: 'e', tenantId: 't1', actions: [], expiresAt: inDays(1) }),
    ).rejects.toBeInstanceOf(CannotDelegateError);
  });
});

describe('DelegationService.revokeDelegation', () => {
  it('issues one conditional update', async () => {
    const db = fakeDb();
    await new DelegationService(db, OPTIONS, granterHolds()).revokeDelegation('d1', 'admin');

    const text = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql;
    expect(text).toMatch(/UPDATE authz_delegation/i);
    expect(text).toMatch(/revoked_at IS NULL/i);
  });
});

describe('DelegationService.listDelegations', () => {
  it('splits rows into granted-by-me and received-by-me', async () => {
    const actor: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
    const db = {
      execute: vi.fn(async () => ({
        rows: [
          { id: 'a', granter_id: 'u1', grantee_id: 'u2', tenant_id: 't1', actions: ['x'], expires_at: inDays(3), revoked_at: null, reason: null, created_at: new Date() },
          { id: 'b', granter_id: 'u3', grantee_id: 'u1', tenant_id: 't1', actions: ['y'], expires_at: inDays(3), revoked_at: null, reason: null, created_at: new Date() },
        ],
      })),
    } as unknown as SqlExecutor;

    const { granted, received } = await new DelegationService(db, OPTIONS, granterHolds()).listDelegations(actor);

    expect(granted.map((d) => d.id)).toEqual(['a']);
    expect(received.map((d) => d.id)).toEqual(['b']);
  });
});
