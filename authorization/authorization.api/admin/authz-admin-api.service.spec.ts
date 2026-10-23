import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AuthzAdminApiService } from './authz-admin-api.service';
import { RoleNotFoundError, type AuthzAdminPort, type AuthzObservabilityPort, type RoleView } from '../../authorization.core.permission-table';
import type { AuthzApiOptions } from '../authz-api.options';
import type { AuthzAuditEmitter } from '../authz-audit.port';
import type { Actor } from '../../authorization.core';

const ROLES: RoleView[] = [
  { id: 'issuer', description: null, grantsAll: false, actions: ['invoice.view'], scope: 'tenant', platformActions: [] },
  { id: 'platform_admin', description: null, grantsAll: true, actions: [], scope: 'platform', platformActions: [] },
];

function deps(overrides: { isPlatformAdmin?: AuthzApiOptions['isPlatformAdmin'] } = {}) {
  const admin: AuthzAdminPort = {
    assignRole: vi.fn().mockResolvedValue(undefined),
    revokeRole: vi.fn().mockResolvedValue(undefined),
    setActionDescription: vi.fn().mockResolvedValue(undefined),
  };
  const observability = { listRoles: vi.fn().mockResolvedValue(ROLES) } as unknown as AuthzObservabilityPort;
  const options: AuthzApiOptions = {
    actionCatalog: [],
    isPlatformAdmin: overrides.isPlatformAdmin ?? ((a: Actor) => a.tenantId === null),
  };
  const audit: AuthzAuditEmitter = { record: vi.fn() };
  return { admin, observability, options, audit, svc: new AuthzAdminApiService(admin, observability, options, audit) };
}

const tenantAdmin: Actor = { id: 'admin-1', persona: 'issuer_admin', tenantId: 't1' };
const platformAdmin: Actor = { id: 'p-1', persona: 'platform', tenantId: null };

describe('AuthzAdminApiService.assignRole', () => {
  it('pins a tenant admin to their own tenant and sets grantedBy to the actor', async () => {
    const { svc, admin } = deps();
    await svc.assignRole(tenantAdmin, { userId: 'u9', tenantId: 't1', roleId: 'issuer' });

    expect(admin.assignRole).toHaveBeenCalledWith({ userId: 'u9', tenantId: 't1', roleId: 'issuer', grantedBy: 'admin-1' });
  });

  it('rejects a tenant admin assigning into another tenant', async () => {
    const { svc } = deps();
    await expect(svc.assignRole(tenantAdmin, { userId: 'u9', tenantId: 't2', roleId: 'issuer' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a tenant admin assigning a grants_all role', async () => {
    const { svc } = deps();
    await expect(
      svc.assignRole(tenantAdmin, { userId: 'u9', tenantId: 't1', roleId: 'platform_admin' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a platform admin assign a grants_all role in any tenant', async () => {
    const { svc, admin } = deps();
    await svc.assignRole(platformAdmin, { userId: 'u9', tenantId: 't5', roleId: 'platform_admin' });
    expect(admin.assignRole).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't5', roleId: 'platform_admin', grantedBy: 'p-1' }),
    );
  });

  it('throws RoleNotFoundError for an unknown role', async () => {
    const { svc } = deps();
    await expect(svc.assignRole(platformAdmin, { userId: 'u9', tenantId: 't1', roleId: 'ghost' })).rejects.toBeInstanceOf(
      RoleNotFoundError,
    );
  });

  it('emits an audit event after a successful assignment', async () => {
    const { svc, audit } = deps();
    await svc.assignRole(tenantAdmin, { userId: 'u9', tenantId: 't1', roleId: 'issuer' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.role_assigned', actorId: 'admin-1', entityType: 'user_role' }),
    );
  });
});

describe('AuthzAdminApiService.revokeRole', () => {
  it('is tenant-scoped for a tenant admin and emits audit', async () => {
    const { svc, admin, audit } = deps();
    await svc.revokeRole(tenantAdmin, { userId: 'u9', tenantId: 't1', roleId: 'issuer' });
    expect(admin.revokeRole).toHaveBeenCalledWith({ userId: 'u9', tenantId: 't1', roleId: 'issuer' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.role_revoked' }));
  });
});

describe('AuthzAdminApiService.setActionDescription', () => {
  it('delegates to the port and emits audit', async () => {
    const { svc, admin, audit } = deps();
    await svc.setActionDescription(platformAdmin, 'invoice.view', 'View invoices');
    expect(admin.setActionDescription).toHaveBeenCalledWith('invoice.view', 'View invoices');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.action_described', entityId: 'invoice.view' }),
    );
  });
});
