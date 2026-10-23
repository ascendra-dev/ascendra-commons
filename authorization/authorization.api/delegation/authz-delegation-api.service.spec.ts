import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Actor, Authorizer } from '../../authorization.core';
import {
  CannotDelegateError,
  InvalidDelegationExpiryError,
  type AuthzObservabilityPort,
  type DelegationService,
  type DelegationView,
} from '../../authorization.core.permission-table';
import type { AuthzAuditEmitter } from '../authz-audit.port';
import { AuthzAccessScope } from '../shared/access-scope';
import { AuthzDelegationApiService } from './authz-delegation-api.service';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const HELD: Record<string, string[]> = { 'admin-1': ['authz.assign_roles'], 'p-1': ['authz.platform'] };

function view(over: Partial<DelegationView> = {}): DelegationView {
  return {
    id: 'd7', granterId: 'granter-1', granteeId: 'u2', tenantId: 't1', actions: ['invoice.void'], lapsedActions: [],
    expiresAt: new Date(Date.now() + 86_400_000), revokedAt: null, revokedBy: null, reason: null, createdAt: new Date(),
    createdBy: 'granter-1', status: 'active', ...over,
  };
}

function deps() {
  const delegation = {
    delegate: vi.fn(async (input) => ({ id: 'd1', ...input, revokedAt: null, reason: input.reason ?? null, createdAt: new Date(), status: 'active' })),
    revokeDelegation: vi.fn().mockResolvedValue(undefined),
    listDelegations: vi.fn().mockResolvedValue({ granted: [], received: [] }),
  } as unknown as DelegationService;
  const observability = {
    listActions: vi.fn().mockResolvedValue([
      { name: 'invoice.void', description: null, scope: 'tenant', roleIds: [] },
      { name: 'job.run', description: null, scope: 'platform', roleIds: [] },
    ]),
    getDelegation: vi.fn().mockResolvedValue(null),
  } as unknown as AuthzObservabilityPort;
  const authorizer: Authorizer = {
    can: async (a: Actor, action: string) => (HELD[a.id] ?? []).includes(action),
    allowedActions: async (a: Actor, actions: string[]) => actions.filter((x) => (HELD[a.id] ?? []).includes(x)),
  };
  const audit: AuthzAuditEmitter = { record: vi.fn() };
  const svc = new AuthzDelegationApiService(delegation, observability, new AuthzAccessScope({ actionCatalog: [] }, authorizer), audit);
  return { delegation, observability, audit, svc };
}

const granter: Actor = { id: 'granter-1', persona: 'member', tenantId: 't1' };
const stranger: Actor = { id: 'u-3', persona: 'member', tenantId: 't1' };
const tenantAdmin: Actor = { id: 'admin-1', persona: 'tenant-admin', tenantId: 't1' };
const otherTenant: Actor = { id: 'admin-9', persona: 'tenant-admin', tenantId: 't2' };
const platformAdmin: Actor = { id: 'p-1', persona: 'platform-admin', tenantId: null };

describe('AuthzDelegationApiService.create', () => {
  it('forces granterId / tenantId / createdBy to the request actor, and audits', async () => {
    const { svc, delegation, audit } = deps();
    await svc.create(granter, { granteeId: 'u2', actions: ['invoice.void'], expiresAt: inDays(7), reason: 'cover' });
    expect(delegation.delegate).toHaveBeenCalledWith(
      expect.objectContaining({ granterId: 'granter-1', tenantId: 't1', createdBy: 'granter-1', reason: 'cover' }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.delegation_granted' }));
  });

  it('refuses no tenant, another tenant, yourself, and platform-wide or unknown actions', async () => {
    const { svc } = deps();
    const body = { granteeId: 'u2', actions: ['invoice.void'], expiresAt: inDays(1) };
    await expect(svc.create({ ...granter, tenantId: null }, body)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.create(granter, { ...body, tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.create(granter, { ...body, granteeId: 'granter-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create(granter, { ...body, actions: ['job.run'] })).rejects.toThrow(/Platform-wide/);
    await expect(svc.create(granter, { ...body, actions: ['nope'] })).rejects.toThrow(/Unknown action/);
  });

  it('400s malformed input and the family’s refusals — never a 500', async () => {
    const { svc, delegation } = deps();
    await expect(svc.create(granter, { granteeId: 'u2', actions: 'invoice.void', expiresAt: inDays(1) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create(granter, { granteeId: 'u2', actions: ['invoice.void'], expiresAt: 'not-a-date' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create(granter, { granteeId: 'u2', actions: ['invoice.void'] } as never)).rejects.toBeInstanceOf(BadRequestException);

    (delegation.delegate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new CannotDelegateError(['invoice.void']));
    await expect(svc.create(granter, { granteeId: 'u2', actions: ['invoice.void'], expiresAt: inDays(1) })).rejects.toBeInstanceOf(BadRequestException);
    (delegation.delegate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new InvalidDelegationExpiryError('too far'));
    await expect(svc.create(granter, { granteeId: 'u2', actions: ['invoice.void'], expiresAt: inDays(1) })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AuthzDelegationApiService.revoke', () => {
  it('404s a delegation that is missing, or in another tenant', async () => {
    const { svc, observability } = deps();
    await expect(svc.revoke(granter, 'd7')).rejects.toBeInstanceOf(NotFoundException);
    (observability.getDelegation as ReturnType<typeof vi.fn>).mockResolvedValueOnce(view());
    await expect(svc.revoke(otherTenant, 'd7')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the granter, the grantee, a role admin of the tenant or a platform admin revoke — no one else', async () => {
    for (const who of [granter, { ...stranger, id: 'u2' }, tenantAdmin, platformAdmin]) {
      const { svc, observability, delegation } = deps();
      (observability.getDelegation as ReturnType<typeof vi.fn>).mockResolvedValueOnce(view());
      await svc.revoke(who, 'd7');
      expect(delegation.revokeDelegation).toHaveBeenCalledWith('d7', who.id);
    }
    const { svc, observability } = deps();
    (observability.getDelegation as ReturnType<typeof vi.fn>).mockResolvedValueOnce(view());
    await expect(svc.revoke(stranger, 'd7')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('changes nothing, and audits nothing, for a delegation already revoked', async () => {
    const { svc, observability, delegation, audit } = deps();
    (observability.getDelegation as ReturnType<typeof vi.fn>).mockResolvedValueOnce(view({ revokedAt: new Date(), status: 'revoked' }));
    await svc.revoke(granter, 'd7');
    expect(delegation.revokeDelegation).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('AuthzDelegationApiService.listMine', () => {
  it('answers from the ledger — lapsed actions included — split into lent and received', async () => {
    const { svc, observability } = deps();
    (observability as unknown as { listDelegations: ReturnType<typeof vi.fn> }).listDelegations = vi.fn().mockResolvedValue({
      delegations: [view(), view({ id: 'd8', granterId: 'u9', granteeId: 'granter-1', lapsedActions: ['invoice.void'] })],
    });
    const mine = await svc.listMine(granter);
    expect(mine.granted.map((d) => d.id)).toEqual(['d7']);
    expect(mine.received[0].lapsedActions).toEqual(['invoice.void']);
    await expect(svc.listMine(platformAdmin)).resolves.toEqual({ granted: [], received: [] });
  });
});
