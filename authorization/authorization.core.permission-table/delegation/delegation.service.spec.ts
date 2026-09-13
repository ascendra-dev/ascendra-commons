import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../authorization.core';
import { DelegationService } from './delegation.service';
import { CannotDelegateError, InvalidDelegationExpiryError } from './delegation.errors';
import { deriveDelegationStatus } from './delegation.rules';
import type { PermissionResolver } from '../resolution/permission-resolver';
import type { DelegationRepository } from '../ports/delegation-repository.port';
import type { CreateDelegationInput, DelegationRecord } from '../types/delegation.types';
import type { ResolvedPermissions } from '../types/resolved-permissions';

const OPTIONS = { maxDelegationDays: 90 };

function inDays(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function fakeRepo() {
  const insert = vi.fn(async (input: CreateDelegationInput): Promise<DelegationRecord> => ({
    id: 'd1',
    granterId: input.granterId,
    granteeId: input.granteeId,
    tenantId: input.tenantId,
    actions: input.actions,
    expiresAt: input.expiresAt,
    revokedAt: null,
    reason: input.reason ?? null,
    createdAt: new Date(),
    status: deriveDelegationStatus(input.expiresAt, null),
  }));
  const revoke = vi.fn(async () => {});
  const getById = vi.fn(async (): Promise<DelegationRecord | null> => null);
  const listForActor = vi.fn(async (): Promise<DelegationRecord[]> => []);
  return { insert, revoke, getById, listForActor } satisfies DelegationRepository;
}

function fakeResolver(rolePerms: ResolvedPermissions): PermissionResolver {
  return { rolePermissions: async () => rolePerms } as unknown as PermissionResolver;
}

const granterHolds = (...actions: string[]): PermissionResolver =>
  fakeResolver({ grantsAll: false, actions: new Set(actions) });

describe('DelegationService.delegate', () => {
  it('creates a delegation when the granter holds every action from their roles', async () => {
    const repo = fakeRepo();
    const svc = new DelegationService(repo, OPTIONS, granterHolds('invoice.void', 'invoice.view'));

    const rec = await svc.delegate({
      granterId: 'granter',
      granteeId: 'grantee',
      tenantId: 't1',
      actions: ['invoice.void'],
      expiresAt: inDays(7),
    });

    expect(rec.id).toBe('d1');
    expect(rec.status).toBe('active');
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects actions the granter does not hold from roles — and never inserts', async () => {
    const repo = fakeRepo();
    const svc = new DelegationService(repo, OPTIONS, granterHolds('invoice.view'));

    await expect(
      svc.delegate({
        granterId: 'granter',
        granteeId: 'grantee',
        tenantId: 't1',
        actions: ['invoice.view', 'payment.refund'],
        expiresAt: inDays(7),
      }),
    ).rejects.toBeInstanceOf(CannotDelegateError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('blocks chains: only rolePermissions is consulted, never effectivePermissions', async () => {
    const resolver = {
      rolePermissions: vi.fn(async () => ({ grantsAll: false, actions: new Set(['a']) })),
      effectivePermissions: vi.fn(),
    } as unknown as PermissionResolver;
    const svc = new DelegationService(fakeRepo(), OPTIONS, resolver);

    await svc.delegate({ granterId: 'g', granteeId: 'e', tenantId: 't', actions: ['a'], expiresAt: inDays(1) });

    expect((resolver.rolePermissions as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((resolver.effectivePermissions as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('a grants_all granter may delegate anything', async () => {
    const svc = new DelegationService(fakeRepo(), OPTIONS, fakeResolver({ grantsAll: true, actions: new Set() }));

    await expect(
      svc.delegate({ granterId: 'g', granteeId: 'e', tenantId: 't1', actions: ['x.y'], expiresAt: inDays(1) }),
    ).resolves.toMatchObject({ id: 'd1' });
  });

  it('rejects a missing / past / too-far expiry', async () => {
    const svc = new DelegationService(fakeRepo(), OPTIONS, granterHolds('a'));
    const base = { granterId: 'g', granteeId: 'e', tenantId: 't1', actions: ['a'] };

    await expect(svc.delegate({ ...base, expiresAt: new Date('invalid') })).rejects.toBeInstanceOf(
      InvalidDelegationExpiryError,
    );
    await expect(svc.delegate({ ...base, expiresAt: inDays(-1) })).rejects.toBeInstanceOf(InvalidDelegationExpiryError);
    await expect(svc.delegate({ ...base, expiresAt: inDays(120) })).rejects.toBeInstanceOf(InvalidDelegationExpiryError);
  });

  it('rejects an empty action list', async () => {
    const svc = new DelegationService(fakeRepo(), OPTIONS, granterHolds('a'));
    await expect(
      svc.delegate({ granterId: 'g', granteeId: 'e', tenantId: 't1', actions: [], expiresAt: inDays(1) }),
    ).rejects.toBeInstanceOf(CannotDelegateError);
  });
});

describe('DelegationService.revokeDelegation', () => {
  it('delegates to the repository', async () => {
    const repo = fakeRepo();
    await new DelegationService(repo, OPTIONS, granterHolds()).revokeDelegation('d1', 'admin');
    expect(repo.revoke).toHaveBeenCalledWith('d1', 'admin');
  });
});

describe('DelegationService.getById', () => {
  it('delegates to the repository', async () => {
    const repo = fakeRepo();
    const record: DelegationRecord = {
      id: 'd1',
      granterId: 'g',
      granteeId: 'e',
      tenantId: 't1',
      actions: ['a'],
      expiresAt: inDays(1),
      revokedAt: null,
      reason: null,
      createdAt: new Date(),
      status: 'active',
    };
    repo.getById.mockResolvedValueOnce(record);

    await expect(new DelegationService(repo, OPTIONS, granterHolds()).getById('d1')).resolves.toEqual(record);
    expect(repo.getById).toHaveBeenCalledWith('d1');
  });

  it('returns null when the repository finds nothing', async () => {
    const repo = fakeRepo();
    await expect(new DelegationService(repo, OPTIONS, granterHolds()).getById('ghost')).resolves.toBeNull();
  });
});

describe('DelegationService.listDelegations', () => {
  it('splits rows into granted-by-me and received-by-me', async () => {
    const actor: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
    const rows: DelegationRecord[] = [
      { id: 'a', granterId: 'u1', granteeId: 'u2', tenantId: 't1', actions: ['x'], expiresAt: inDays(3), revokedAt: null, reason: null, createdAt: new Date(), status: 'active' },
      { id: 'b', granterId: 'u3', granteeId: 'u1', tenantId: 't1', actions: ['y'], expiresAt: inDays(3), revokedAt: null, reason: null, createdAt: new Date(), status: 'active' },
    ];
    const repo = fakeRepo();
    repo.listForActor.mockResolvedValueOnce(rows);

    const { granted, received } = await new DelegationService(repo, OPTIONS, granterHolds()).listDelegations(actor);

    expect(granted.map((d) => d.id)).toEqual(['a']);
    expect(received.map((d) => d.id)).toEqual(['b']);
  });
});
