import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthzObservabilityApiService } from './authz-observability-api.service';
import type { AuthzObservabilityPort } from '../../authorization.core.permission-table';
import type { AuthzApiOptions } from '../authz-api.options';

function fakePort(): AuthzObservabilityPort {
  return {
    listRoles: vi.fn().mockResolvedValue([{ id: 'issuer', description: null, grantsAll: false, actions: [], scope: 'tenant', platformActions: [] }]),
    getRole: vi.fn().mockResolvedValue({ id: 'issuer', description: null, grantsAll: false, actions: [], scope: 'tenant', platformActions: [] }),
    countHolders: vi.fn().mockResolvedValue(3),
    listUserRoleAssignments: vi.fn().mockResolvedValue({ assignments: [] }),
    listActions: vi.fn().mockResolvedValue([]),
    getDelegation: vi.fn().mockResolvedValue(null),
    exactTenantHolders: vi.fn().mockResolvedValue([]),
    explainAccess: vi.fn().mockResolvedValue({ userId: 'u1', tenantId: 't1', roles: [], delegations: [], effectiveActions: [] }),
    listDelegations: vi.fn().mockResolvedValue({ delegations: [] }),
    actionCatalogHealth: vi.fn().mockResolvedValue({
      inCodeNotInDb: [],
      inDbNotInCode: [],
      grantedButUndescribed: [],
      describedCount: 0,
      totalCount: 0,
    }),
    whoCan: vi.fn().mockResolvedValue({ action: 'invoice.void', tenantId: 't1', roles: [], delegations: [] }),
  };
}

const OPTIONS: AuthzApiOptions = { actionCatalog: ['invoice.view', 'invoice.void'], isPlatformAdmin: () => true };

describe('AuthzObservabilityApiService', () => {
  it('passes reads straight through to the port', async () => {
    const port = fakePort();
    const svc = new AuthzObservabilityApiService(port, OPTIONS);

    await svc.listRoles();
    await svc.listAssignments({ userId: 'u1' });
    await svc.listDelegations({ status: 'active' });
    await svc.explainAccess({ userId: 'u1', tenantId: 't1', action: 'invoice.void' });

    expect(port.listRoles).toHaveBeenCalled();
    expect(port.listUserRoleAssignments).toHaveBeenCalledWith({ userId: 'u1' });
    expect(port.listDelegations).toHaveBeenCalledWith({ status: 'active' });
    expect(port.explainAccess).toHaveBeenCalledWith('u1', 't1', 'invoice.void');
  });

  it('supplies the configured action catalog to actionCatalogHealth', async () => {
    const port = fakePort();
    await new AuthzObservabilityApiService(port, OPTIONS).actionCatalogHealth();
    expect(port.actionCatalogHealth).toHaveBeenCalledWith(['invoice.view', 'invoice.void']);
  });
});

describe('AuthzObservabilityApiService.getRole', () => {
  it('merges the role with its holder count', async () => {
    const port = fakePort();
    const detail = await new AuthzObservabilityApiService(port, OPTIONS).getRole('issuer');
    expect(detail).toEqual({ id: 'issuer', description: null, grantsAll: false, actions: [], scope: 'tenant', platformActions: [], holderCount: 3 });
    expect(port.countHolders).toHaveBeenCalledWith('issuer');
  });

  it('throws NotFoundException (404) for an unknown role, without calling countHolders', async () => {
    const port = fakePort();
    (port.getRole as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(new AuthzObservabilityApiService(port, OPTIONS).getRole('ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(port.countHolders).not.toHaveBeenCalled();
  });
});

describe('AuthzObservabilityApiService.listDelegations (expiring)', () => {
  it('passes expiringWithinDays through to the port', async () => {
    const port = fakePort();
    await new AuthzObservabilityApiService(port, OPTIONS).listDelegations({ expiringWithinDays: 7, tenantId: 't1' });
    expect(port.listDelegations).toHaveBeenCalledWith({ expiringWithinDays: 7, tenantId: 't1' });
  });
});

describe('AuthzObservabilityApiService.whoCan', () => {
  it('passes action and tenantId through to the port', async () => {
    const port = fakePort();
    await new AuthzObservabilityApiService(port, OPTIONS).whoCan({ action: 'invoice.void', tenantId: 't1' });
    expect(port.whoCan).toHaveBeenCalledWith('invoice.void', 't1');
  });

  it('rejects a missing action with BadRequestException', async () => {
    const port = fakePort();
    await expect(
      new AuthzObservabilityApiService(port, OPTIONS).whoCan({ action: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(port.whoCan).not.toHaveBeenCalled();
  });
});
