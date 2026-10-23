import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Actor, Authorizer } from '../../authorization.core';
import { ActionNotFoundError, type ActionHolder, type AuthzAdminPort, type AuthzObservabilityPort, type RoleView } from '../../authorization.core.permission-table';
import type { AuthzAuditEmitter } from '../authz-audit.port';
import { AuthzAccessScope } from '../shared/access-scope';
import { AuthzAdminApiService } from './authz-admin-api.service';

const role = (id: string, actions: string[], extra: Partial<RoleView> = {}): RoleView => ({
  id, description: null, grantsAll: false, actions, scope: 'tenant', platformActions: [], ...extra,
});
const ROLES: RoleView[] = [
  role('member', ['invoice.view']),
  role('tenant-admin', ['invoice.view', 'authz.assign_roles']),
  role('approver', ['invoice.view', 'payout.approve']),
  role('ops', ['job.run'], { scope: 'platform', platformActions: ['job.run'] }),
  role('platform-admin', [], { grantsAll: true, scope: 'platform' }),
];

/** Who holds what — the fake authorizer behind `AuthzAccessScope`. */
const HELD: Record<string, string[]> = {
  'admin-1': ['invoice.view', 'authz.assign_roles'],
  'p-1': ['authz.platform'],
};

function deps(holders: ActionHolder[] = []) {
  const admin: AuthzAdminPort = {
    assignRole: vi.fn().mockResolvedValue(undefined),
    revokeRole: vi.fn().mockResolvedValue(true),
    setActionDescription: vi.fn().mockResolvedValue(undefined),
  };
  const observability = {
    listRoles: vi.fn().mockResolvedValue(ROLES),
    getRole: vi.fn(async (id: string) => ROLES.find((r) => r.id === id) ?? null),
    exactTenantHolders: vi.fn().mockResolvedValue(holders),
  } as unknown as AuthzObservabilityPort;
  const authorizer: Authorizer = {
    can: async (a: Actor, action: string) => (HELD[a.id] ?? []).includes(action),
    allowedActions: async (a: Actor, actions: string[]) => actions.filter((x) => (HELD[a.id] ?? []).includes(x)),
  };
  const scope = new AuthzAccessScope({ actionCatalog: [] }, authorizer);
  const audit: AuthzAuditEmitter = { record: vi.fn() };
  return { admin, observability, audit, svc: new AuthzAdminApiService(admin, observability, scope, audit) };
}

const tenantAdmin: Actor = { id: 'admin-1', persona: 'tenant-admin', tenantId: 't1' };
const platformAdmin: Actor = { id: 'p-1', persona: 'platform-admin', tenantId: null };
const support: Actor = { id: 's-1', persona: 'support', tenantId: null };

describe('AuthzAdminApiService.assignRole', () => {
  it('pins a tenant admin to their own tenant and sets grantedBy to the actor', async () => {
    const { svc, admin, audit } = deps();
    await svc.assignRole(tenantAdmin, 'u9', { roleId: 'member' });
    expect(admin.assignRole).toHaveBeenCalledWith({ userId: 'u9', tenantId: 't1', roleId: 'member', grantedBy: 'admin-1', expiresAt: null });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.role_assigned', actorId: 'admin-1', tenantId: 't1' }));
  });

  it('carries an expiry, and refuses one in the past', async () => {
    const { svc, admin } = deps();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    await svc.assignRole(tenantAdmin, 'u9', { roleId: 'member', expiresAt });
    expect(admin.assignRole).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: new Date(expiresAt) }));
    await expect(svc.assignRole(tenantAdmin, 'u9', { roleId: 'member', expiresAt: '2020-01-01T00:00:00Z' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses another tenant, and an all-tenant assignment, to a tenant admin', async () => {
    const { svc } = deps();
    await expect(svc.assignRole(tenantAdmin, 'u9', { roleId: 'member', tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assignRole(tenantAdmin, 'u9', { roleId: 'member', tenantId: null })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a role with platform-wide actions, or that grants all, inside a tenant — even to a platform admin', async () => {
    const { svc } = deps();
    await expect(svc.assignRole(tenantAdmin, 'admin-1', { roleId: 'platform-admin' })).rejects.toThrow(/every action/);
    await expect(svc.assignRole(tenantAdmin, 'u9', { roleId: 'ops' })).rejects.toThrow(/platform-wide actions \(job\.run\)/);
    await expect(svc.assignRole(platformAdmin, 'u9', { roleId: 'ops', tenantId: 't5' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a platform admin assign a platform role globally', async () => {
    const { svc, admin } = deps();
    await svc.assignRole(platformAdmin, 'u9', { roleId: 'platform-admin', tenantId: null });
    expect(admin.assignRole).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null, roleId: 'platform-admin', grantedBy: 'p-1' }));
  });

  it("refuses a tenant admin a role holding an action it doesn't hold itself", async () => {
    const { svc } = deps();
    await expect(svc.assignRole(tenantAdmin, 'u9', { roleId: 'approver' })).rejects.toThrow(/also grants payout\.approve/);
  });

  it('decides platform by authz.platform, not by having no tenant', async () => {
    const { svc } = deps();
    await expect(svc.assignRole(support, 'u9', { roleId: 'platform-admin', tenantId: null })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s an unknown role and 400s a missing or malformed field', async () => {
    const { svc } = deps();
    await expect(svc.assignRole(platformAdmin, 'u9', { roleId: 'ghost' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.assignRole(platformAdmin, 'u9', {} as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.assignRole(platformAdmin, 'u\u00009', { roleId: 'member' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.assignRole(platformAdmin, 'u9', { roleId: 42 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AuthzAdminApiService.revokeRole', () => {
  it('is tenant-scoped for a tenant admin and audits a removal', async () => {
    const { svc, admin, audit } = deps([{ userId: 'admin-1', roleId: 'tenant-admin' }]);
    await svc.revokeRole(tenantAdmin, 'u9', 'member', {});
    expect(admin.revokeRole).toHaveBeenCalledWith({ userId: 'u9', tenantId: 't1', roleId: 'member' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.role_revoked', tenantId: 't1' }));
  });

  it('404s a role the user does not hold — and audits nothing', async () => {
    const { svc, admin, audit } = deps();
    (admin.revokeRole as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await expect(svc.revokeRole(tenantAdmin, 'u9', 'member', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses taking away your own role management, and removing the last admin of a tenant', async () => {
    const own = deps([{ userId: 'admin-1', roleId: 'tenant-admin' }, { userId: 'admin-2', roleId: 'tenant-admin' }]);
    await expect(own.svc.revokeRole(tenantAdmin, 'admin-1', 'tenant-admin', {})).rejects.toThrow(/your own authz\.assign_roles/);

    const last = deps([{ userId: 'admin-2', roleId: 'tenant-admin' }]);
    await expect(last.svc.revokeRole(platformAdmin, 'admin-2', 'tenant-admin', { tenantId: 't1' })).rejects.toBeInstanceOf(ConflictException);
    expect(last.admin.revokeRole).not.toHaveBeenCalled();

    const another = deps([{ userId: 'admin-1', roleId: 'tenant-admin' }, { userId: 'admin-2', roleId: 'tenant-admin' }]);
    await another.svc.revokeRole(tenantAdmin, 'admin-2', 'tenant-admin', {});
    expect(another.admin.revokeRole).toHaveBeenCalled();
  });

  it('keeps one authz.platform holder on a global revoke', async () => {
    const { svc } = deps([{ userId: 'p-2', roleId: 'platform-admin' }]);
    await expect(svc.revokeRole(platformAdmin, 'p-2', 'platform-admin', { global: 'true' })).rejects.toThrow(/last holder of authz\.platform/);
  });
});

describe('AuthzAdminApiService.assignMany / assignableRoles / setActionDescription', () => {
  it('assigns one role to many users after one ceiling check, auditing each', async () => {
    const { svc, admin, audit } = deps();
    await expect(svc.assignMany(tenantAdmin, 'member', { userIds: ['u1', 'u2', 'u1'] })).resolves.toEqual({ assigned: ['u1', 'u2'] });
    expect(admin.assignRole).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledTimes(2);
    await expect(svc.assignMany(tenantAdmin, 'member', { userIds: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists every role with whether this actor may assign it, and why not', async () => {
    const { svc } = deps();
    const roles = await svc.assignableRoles(tenantAdmin, undefined);
    const byId = Object.fromEntries(roles.map((r) => [r.id, r]));
    expect(byId.member.assignable).toBe(true);
    expect(byId['tenant-admin'].assignable).toBe(true);
    expect(byId.approver).toMatchObject({ assignable: false, reason: expect.stringContaining('payout.approve') });
    expect(byId.ops.assignable).toBe(false);
    expect(byId['platform-admin'].assignable).toBe(false);
  });

  it('describes an action for a platform admin only; 404 for an unknown one', async () => {
    const { svc, admin } = deps();
    await expect(svc.setActionDescription(tenantAdmin, 'invoice.view', 'x')).rejects.toBeInstanceOf(ForbiddenException);
    await svc.setActionDescription(platformAdmin, 'invoice.view', 'View invoices');
    expect(admin.setActionDescription).toHaveBeenCalledWith('invoice.view', 'View invoices');

    (admin.setActionDescription as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ActionNotFoundError('ghost'));
    await expect(svc.setActionDescription(platformAdmin, 'ghost', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
