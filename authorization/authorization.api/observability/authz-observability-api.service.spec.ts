import { describe, expect, it, vi } from 'vitest';
import { AuthzObservabilityApiService } from './authz-observability-api.service';
import type { AuthzObservabilityPort } from '../../authorization.core.permission-table';
import type { AuthzApiOptions } from '../authz-api.options';

function fakePort(): AuthzObservabilityPort {
  return {
    listRoles: vi.fn().mockResolvedValue([{ id: 'issuer', description: null, grantsAll: false, actions: [] }]),
    listUserRoleAssignments: vi.fn().mockResolvedValue([]),
    explainAccess: vi.fn().mockResolvedValue({ userId: 'u1', tenantId: 't1', roles: [], delegations: [], effectiveActions: [] }),
    listDelegations: vi.fn().mockResolvedValue({ delegations: [] }),
    actionCatalogHealth: vi.fn().mockResolvedValue({
      inCodeNotInDb: [],
      inDbNotInCode: [],
      grantedButUndescribed: [],
      describedCount: 0,
      totalCount: 0,
    }),
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
