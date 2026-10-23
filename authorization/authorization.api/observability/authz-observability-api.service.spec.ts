import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Actor, Authorizer } from '../../authorization.core';
import { InvalidAuthzCursorError, type AuthzObservabilityPort } from '../../authorization.core.permission-table';
import { AuthzAccessScope } from '../shared/access-scope';
import { AuthzObservabilityApiService } from './authz-observability-api.service';

function fakePort(): AuthzObservabilityPort {
  return {
    listRoles: vi.fn().mockResolvedValue([]),
    getRole: vi.fn().mockResolvedValue({ id: 'issuer', description: null, grantsAll: false, actions: [], scope: 'tenant', platformActions: [] }),
    countHolders: vi.fn().mockResolvedValue(3),
    listActions: vi.fn().mockResolvedValue([]),
    listUserRoleAssignments: vi.fn().mockResolvedValue({ assignments: [], nextCursor: 'c2' }),
    explainAccess: vi.fn().mockResolvedValue({ userId: 'u1', tenantId: 't1', roles: [], delegations: [], effectiveActions: [] }),
    listDelegations: vi.fn().mockResolvedValue({ delegations: [] }),
    getDelegation: vi.fn().mockResolvedValue(null),
    actionCatalogHealth: vi.fn().mockResolvedValue({ inCodeNotInDb: [], inDbNotInCode: [], grantedButUndescribed: [], describedCount: 0, totalCount: 0 }),
    whoCan: vi.fn().mockResolvedValue({ action: 'invoice.void', tenantId: 't1', roles: [], delegations: [] }),
    exactTenantHolders: vi.fn().mockResolvedValue([]),
    accessStats: vi.fn(),
  };
}

const authorizer: Authorizer = { can: async (a: Actor, action: string) => a.id === 'p-1' && action === 'authz.platform' };
const svcFor = (port: AuthzObservabilityPort) =>
  new AuthzObservabilityApiService(port, { actionCatalog: ['invoice.view'] }, new AuthzAccessScope({ actionCatalog: [] }, authorizer));

const tenantAdmin: Actor = { id: 'admin-1', persona: 'tenant-admin', tenantId: 't1' };
const platformAdmin: Actor = { id: 'p-1', persona: 'platform-admin', tenantId: null };
const support: Actor = { id: 's-1', persona: 'support', tenantId: null };

describe('AuthzObservabilityApiService — tenant scope', () => {
  it("forces a tenant admin's reads to its own tenant, and refuses another tenant", async () => {
    const port = fakePort();
    const svc = svcFor(port);
    await svc.listAssignments(tenantAdmin, {});
    expect(port.listUserRoleAssignments).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    await svc.listDelegations(tenantAdmin, {});
    expect(port.listDelegations).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    await svc.explainAccess(tenantAdmin, { userId: 'u2' });
    expect(port.explainAccess).toHaveBeenCalledWith('u2', 't1', undefined);
    await svc.whoCan(tenantAdmin, { action: 'invoice.void' });
    expect(port.whoCan).toHaveBeenCalledWith('invoice.void', 't1');

    await expect(svc.listAssignments(tenantAdmin, { tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.explainAccess(tenantAdmin, { userId: 'u2', tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.whoCan(tenantAdmin, { action: 'x', tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.listAssignments(tenantAdmin, { global: 'true' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a platform admin read any tenant, every tenant, or the global assignments', async () => {
    const port = fakePort();
    const svc = svcFor(port);
    await svc.listAssignments(platformAdmin, { tenantId: 't2' });
    expect(port.listUserRoleAssignments).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: 't2' }));
    await svc.listAssignments(platformAdmin, {});
    expect(port.listUserRoleAssignments).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: undefined }));
    await svc.listAssignments(platformAdmin, { global: 'true' });
    expect(port.listUserRoleAssignments).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: null }));
  });

  it('treats a tenant-less actor without authz.platform as nobody’s — not as a platform admin', async () => {
    const svc = svcFor(fakePort());
    await expect(svc.listAssignments(support, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("counts a role's holders in the viewer's tenant", async () => {
    const port = fakePort();
    await expect(svcFor(port).getRole(tenantAdmin, 'issuer')).resolves.toMatchObject({ id: 'issuer', holderCount: 3 });
    expect(port.countHolders).toHaveBeenCalledWith('issuer', 't1');
    await svcFor(port).getRole(platformAdmin, 'issuer');
    expect(port.countHolders).toHaveBeenLastCalledWith('issuer', undefined);
  });
});

describe('AuthzObservabilityApiService — answers', () => {
  it('answers lists in Rule 4’s shape', async () => {
    await expect(svcFor(fakePort()).listAssignments(platformAdmin, {})).resolves.toEqual({ data: [], meta: { nextCursor: 'c2' } });
  });

  it('400s a bad param and a cursor it never issued — never a 500', async () => {
    const port = fakePort();
    const svc = svcFor(port);
    await expect(svc.listAssignments(platformAdmin, { limit: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.listAssignments(platformAdmin, { status: 'lost' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.listDelegations(platformAdmin, { status: 'lost' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.listAssignments(platformAdmin, { userId: 'a\u0000b' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.explainAccess(platformAdmin, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.whoCan(platformAdmin, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.listDelegations(platformAdmin, {}, 'soon')).rejects.toBeInstanceOf(BadRequestException);

    (port.listDelegations as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new InvalidAuthzCursorError('garbage'));
    await expect(svc.listDelegations(platformAdmin, { cursor: 'garbage' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s an unknown role and a delegation that is missing or in another tenant', async () => {
    const port = fakePort();
    const svc = svcFor(port);
    (port.getRole as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(svc.getRole(platformAdmin, 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(port.countHolders).not.toHaveBeenCalled();

    await expect(svc.getDelegation(platformAdmin, 'd1')).rejects.toBeInstanceOf(NotFoundException);
    (port.getDelegation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'd1', tenantId: 't2' });
    await expect(svc.getDelegation(tenantAdmin, 'd1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("answers a user's own access in their own tenant", async () => {
    const port = fakePort();
    await svcFor(port).myAccess(tenantAdmin);
    expect(port.explainAccess).toHaveBeenCalledWith('admin-1', 't1');
  });

  it('checks catalog health against the configured catalog', async () => {
    const port = fakePort();
    await svcFor(port).actionCatalogHealth();
    expect(port.actionCatalogHealth).toHaveBeenCalledWith(['invoice.view']);
  });
});
