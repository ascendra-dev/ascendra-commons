import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthzDelegationApiService } from './authz-delegation-api.service';
import type { DelegationRecord, DelegationService } from '../../authorization.core.permission-table';
import type { AuthzApiOptions } from '../authz-api.options';
import type { AuthzAuditEmitter } from '../authz-audit.port';
import type { Actor } from '../../authorization.core';

function inDays(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

function deps(overrides: { isPlatformAdmin?: AuthzApiOptions['isPlatformAdmin'] } = {}) {
  const delegation = {
    delegate: vi.fn(async (input) => ({
      id: 'd1',
      granterId: input.granterId,
      granteeId: input.granteeId,
      tenantId: input.tenantId,
      actions: input.actions,
      expiresAt: input.expiresAt,
      revokedAt: null,
      reason: input.reason ?? null,
      createdAt: new Date(),
      status: 'active' as const,
    })),
    revokeDelegation: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn(async (): Promise<DelegationRecord | null> => null),
    listDelegations: vi.fn().mockResolvedValue({ granted: [], received: [] }),
  } as unknown as DelegationService;
  const options: AuthzApiOptions = {
    actionCatalog: [],
    isPlatformAdmin: overrides.isPlatformAdmin ?? ((a: Actor) => a.tenantId === null),
  };
  const audit: AuthzAuditEmitter = { record: vi.fn() };
  return { delegation, options, audit, svc: new AuthzDelegationApiService(delegation, options, audit) };
}

const actor: Actor = { id: 'granter-1', persona: 'issuer', tenantId: 't1' };
const platformActor: Actor = { id: 'p-1', persona: 'platform', tenantId: null };

describe('AuthzDelegationApiService.create', () => {
  it('forces granterId/tenantId/createdBy to the request actor', async () => {
    const { svc, delegation } = deps();
    await svc.create(actor, { granteeId: 'u2', actions: ['invoice.void'], expiresAt: inDays(7) });

    expect(delegation.delegate).toHaveBeenCalledWith(
      expect.objectContaining({ granterId: 'granter-1', tenantId: 't1', createdBy: 'granter-1' }),
    );
  });

  it('rejects a null-tenant actor', async () => {
    const { svc } = deps();
    await expect(
      svc.create({ ...actor, tenantId: null }, { granteeId: 'u2', actions: ['x'], expiresAt: inDays(1) }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a body tenantId that is not the actor tenant', async () => {
    const { svc } = deps();
    await expect(
      svc.create(actor, { granteeId: 'u2', tenantId: 't2', actions: ['x'], expiresAt: inDays(1) }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unparseable expiresAt', async () => {
    const { svc } = deps();
    await expect(
      svc.create(actor, { granteeId: 'u2', actions: ['x'], expiresAt: 'not-a-date' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('emits an audit event on success', async () => {
    const { svc, audit } = deps();
    await svc.create(actor, { granteeId: 'u2', actions: ['invoice.void'], expiresAt: inDays(7) });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.delegation_granted', entityId: 'd1' }),
    );
  });
});

describe('AuthzDelegationApiService.revoke', () => {
  it('revokes with the actor as revokedBy and emits audit', async () => {
    const { svc, delegation, audit } = deps();
    await svc.revoke(actor, 'd7');
    expect(delegation.revokeDelegation).toHaveBeenCalledWith('d7', 'granter-1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.delegation_revoked', entityId: 'd7' }));
  });

  it('rejects a non-platform actor revoking a delegation belonging to another tenant', async () => {
    const { svc, delegation } = deps();
    (delegation.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'd7',
      granterId: 'someone-else',
      granteeId: 'u2',
      tenantId: 't2',
      actions: ['invoice.void'],
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      reason: null,
      createdAt: new Date(),
      status: 'active' as const,
    });

    await expect(svc.revoke(actor, 'd7')).rejects.toBeInstanceOf(ForbiddenException);
    expect(delegation.revokeDelegation).not.toHaveBeenCalled();
  });

  it('allows a platform admin to revoke a delegation in any tenant', async () => {
    const { svc, delegation } = deps();
    (delegation.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'd7',
      granterId: 'someone-else',
      granteeId: 'u2',
      tenantId: 't2',
      actions: ['invoice.void'],
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      reason: null,
      createdAt: new Date(),
      status: 'active' as const,
    });

    await svc.revoke(platformActor, 'd7');
    expect(delegation.revokeDelegation).toHaveBeenCalledWith('d7', 'p-1');
  });

  it('allows revoking a delegation within the actor\'s own tenant', async () => {
    const { svc, delegation } = deps();
    (delegation.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'd7',
      granterId: actor.id,
      granteeId: 'u2',
      tenantId: 't1',
      actions: ['invoice.void'],
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      reason: null,
      createdAt: new Date(),
      status: 'active' as const,
    });

    await svc.revoke(actor, 'd7');
    expect(delegation.revokeDelegation).toHaveBeenCalledWith('d7', 'granter-1');
  });

  it('does not block revoking an id the repository has no record of (idempotent no-op)', async () => {
    const { svc, delegation } = deps();
    await svc.revoke(actor, 'ghost');
    expect(delegation.revokeDelegation).toHaveBeenCalledWith('ghost', 'granter-1');
  });
});
