import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AUTHZ_ADMIN_PORT,
  AUTHZ_DELEGATION_SERVICE,
  AUTHZ_OBSERVABILITY_PORT,
} from '../authorization.core.permission-table';
import { AuthorizationApiModule } from './authorization-api.module';
import { AuthzObservabilityController } from './observability/authz-observability.controller';
import { AuthzAdminController } from './admin/authz-admin.controller';
import { AuthzDelegationController } from './delegation/authz-delegation.controller';
import { AUTHZ_AUDIT_EMITTER } from './tokens';
import type { Actor } from '../authorization.core';

const listRoles = vi.fn().mockResolvedValue([{ id: 'issuer', description: null, grantsAll: false, actions: [] }]);
const assignRole = vi.fn().mockResolvedValue(undefined);
const delegate = vi.fn().mockResolvedValue({
  id: 'd1',
  granterId: 'a1',
  granteeId: 'u2',
  tenantId: 't1',
  actions: ['invoice.void'],
  expiresAt: new Date(Date.now() + 86_400_000),
  revokedAt: null,
  reason: null,
  createdAt: new Date(),
  status: 'active',
});
const auditRecord = vi.fn();

@Module({
  providers: [
    {
      provide: AUTHZ_OBSERVABILITY_PORT,
      useValue: {
        listRoles,
        listUserRoleAssignments: vi.fn().mockResolvedValue([]),
        explainAccess: vi.fn(),
        listDelegations: vi.fn().mockResolvedValue({ delegations: [] }),
        actionCatalogHealth: vi.fn().mockResolvedValue({
          inCodeNotInDb: [],
          inDbNotInCode: [],
          grantedButUndescribed: [],
          describedCount: 0,
          totalCount: 0,
        }),
      },
    },
    {
      provide: AUTHZ_ADMIN_PORT,
      useValue: { assignRole, revokeRole: vi.fn(), setActionDescription: vi.fn() },
    },
    {
      provide: AUTHZ_DELEGATION_SERVICE,
      useValue: { delegate, revokeDelegation: vi.fn(), listDelegations: vi.fn().mockResolvedValue({ granted: [], received: [] }) },
    },
    { provide: 'MY_AUDIT', useValue: { record: auditRecord } },
  ],
  exports: [AUTHZ_OBSERVABILITY_PORT, AUTHZ_ADMIN_PORT, AUTHZ_DELEGATION_SERVICE, 'MY_AUDIT'],
})
class FakePortsModule {}

describe('AuthorizationApiModule.forRoot — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [
        AuthorizationApiModule.forRoot({
          actionCatalog: ['invoice.view', 'invoice.void'],
          auditEmitterToken: 'MY_AUDIT',
          imports: [FakePortsModule],
        }),
      ],
    }).compile();
  }

  const platformActor: Actor = { id: 'a1', persona: 'platform', tenantId: null };

  it('resolves all three controllers', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(AuthzObservabilityController)).toBeInstanceOf(AuthzObservabilityController);
    expect(moduleRef.get(AuthzAdminController)).toBeInstanceOf(AuthzAdminController);
    expect(moduleRef.get(AuthzDelegationController)).toBeInstanceOf(AuthzDelegationController);
  });

  it('observability controller routes through to the port', async () => {
    const moduleRef = await build();
    await moduleRef.get(AuthzObservabilityController).roles();
    expect(listRoles).toHaveBeenCalled();
  });

  it('admin controller routes through to the port, actor-scoped, and audits via the bound emitter', async () => {
    const moduleRef = await build();
    await moduleRef.get(AuthzAdminController).assign(platformActor, { userId: 'u2', tenantId: 't1', roleId: 'issuer' });
    expect(assignRole).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2', roleId: 'issuer', grantedBy: 'a1' }),
    );
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.role_assigned' }));
  });

  it('delegation controller forces the granter to the request actor', async () => {
    const moduleRef = await build();
    await moduleRef.get(AuthzDelegationController).create(
      { id: 'a1', persona: 'issuer', tenantId: 't1' },
      { granteeId: 'u2', actions: ['invoice.void'], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    );
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ granterId: 'a1', tenantId: 't1' }));
  });

  it('falls back to the no-op audit emitter when auditEmitterToken is omitted', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthorizationApiModule.forRoot({ actionCatalog: [], imports: [FakePortsModule] })],
    }).compile();
    expect(moduleRef.get(AUTHZ_AUDIT_EMITTER)).toBeDefined();
  });
});
