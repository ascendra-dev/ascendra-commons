import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthzDelegationApiService } from './authz-delegation-api.service';
import type { DelegationService } from '../../authorization.core.permission-table';
import type { AuthzAuditEmitter } from '../authz-audit.port';
import type { Actor } from '../../authorization.core';

function inDays(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

function deps() {
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
    listDelegations: vi.fn().mockResolvedValue({ granted: [], received: [] }),
  } as unknown as DelegationService;
  const audit: AuthzAuditEmitter = { record: vi.fn() };
  return { delegation, audit, svc: new AuthzDelegationApiService(delegation, audit) };
}

const actor: Actor = { id: 'granter-1', persona: 'issuer', tenantId: 't1' };

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
});
