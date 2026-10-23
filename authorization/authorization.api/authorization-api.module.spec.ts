import { describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Module, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthorizationEnforcedGuard, type Actor } from '../authorization.core';
import {
  AUTHZ_ADMIN_PORT,
  AUTHZ_DELEGATION_SERVICE,
  AUTHZ_OBSERVABILITY_PORT,
  PERMISSION_TABLE_AUTHORIZER,
  type AuthzObservabilityPort,
} from '../authorization.core.permission-table';
import { AuthorizationApiModule } from './authorization-api.module';
import { AuthzObservabilityController } from './observability/authz-observability.controller';
import { AuthzAdminController } from './admin/authz-admin.controller';
import { AuthzDelegationController } from './delegation/authz-delegation.controller';
import { AUTHZ_AUDIT_EMITTER } from './tokens';

const ROLE = { id: 'issuer', description: null, grantsAll: false, actions: ['invoice.void'], scope: 'tenant', platformActions: [] };
const listRoles = vi.fn().mockResolvedValue([ROLE]);
const assignRole = vi.fn().mockResolvedValue(undefined);
const delegate = vi.fn().mockResolvedValue({ id: 'd1', granterId: 'a1', granteeId: 'u2', tenantId: 't1', actions: ['invoice.void'] });
const auditRecord = vi.fn();

@Module({
  providers: [
    {
      provide: AUTHZ_OBSERVABILITY_PORT,
      useValue: {
        listRoles,
        getRole: vi.fn().mockResolvedValue(ROLE),
        countHolders: vi.fn().mockResolvedValue(0),
        listActions: vi.fn().mockResolvedValue([{ name: 'invoice.void', description: null, scope: 'tenant', roleIds: ['issuer'] }]),
        listUserRoleAssignments: vi.fn().mockResolvedValue({ assignments: [] }),
        explainAccess: vi.fn(),
        listDelegations: vi.fn().mockResolvedValue({ delegations: [] }),
        getDelegation: vi.fn().mockResolvedValue(null),
        actionCatalogHealth: vi.fn(),
        whoCan: vi.fn().mockResolvedValue({ action: 'invoice.void', tenantId: null, roles: [], delegations: [] }),
        exactTenantHolders: vi.fn().mockResolvedValue([]),
    accessStats: vi.fn(),
      },
    },
    { provide: AUTHZ_ADMIN_PORT, useValue: { assignRole, revokeRole: vi.fn(), setActionDescription: vi.fn() } },
    {
      provide: AUTHZ_DELEGATION_SERVICE,
      useValue: { delegate, revokeDelegation: vi.fn(), listDelegations: vi.fn().mockResolvedValue({ granted: [], received: [] }) },
    },
    // The permission-table authorizer: only `a1` holds authz.platform.
    { provide: PERMISSION_TABLE_AUTHORIZER, useValue: { can: async (a: Actor, action: string) => a.id === 'a1' && action === 'authz.platform' } },
    { provide: 'MY_AUDIT', useValue: { record: auditRecord } },
  ],
  exports: [AUTHZ_OBSERVABILITY_PORT, AUTHZ_ADMIN_PORT, AUTHZ_DELEGATION_SERVICE, PERMISSION_TABLE_AUTHORIZER, 'MY_AUDIT'],
})
class FakePortsModule {}

const build = () =>
  Test.createTestingModule({
    imports: [
      AuthorizationApiModule.forRoot({ actionCatalog: ['invoice.void'], auditEmitterToken: 'MY_AUDIT', imports: [FakePortsModule] }),
    ],
  }).compile();

const platformActor: Actor = { id: 'a1', persona: 'platform', tenantId: null };

describe('AuthorizationApiModule.forRoot — real DI wiring', () => {
  it('resolves the three controllers, each failing closed without the global AuthorizationGuard', async () => {
    const moduleRef = await build();
    for (const controller of [AuthzObservabilityController, AuthzAdminController, AuthzDelegationController]) {
      expect(moduleRef.get(controller)).toBeInstanceOf(controller);
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(AuthorizationEnforcedGuard);
    }
  });

  it('registers the admin controller first — its static roles/assignable before roles/:id', async () => {
    const mod = AuthorizationApiModule.forRoot({ actionCatalog: [] });
    expect(mod.controllers![0]).toBe(AuthzAdminController);
  });

  it('routes reads through to the port', async () => {
    const moduleRef = await build();
    await moduleRef.get(AuthzObservabilityController).roles();
    expect(listRoles).toHaveBeenCalled();
  });

  it('decides platform by the permission-table authorizer, and audits via the bound emitter', async () => {
    const moduleRef = await build();
    await moduleRef.get(AuthzAdminController).assign(platformActor, 'u2', { roleId: 'issuer', tenantId: 't1' });
    expect(assignRole).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', tenantId: 't1', grantedBy: 'a1' }));
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.role_assigned' }));
  });

  it('forces the delegation granter to the request actor', async () => {
    const moduleRef = await build();
    await moduleRef.get(AuthzDelegationController).create(
      { id: 'g1', persona: 'member', tenantId: 't1' },
      { granteeId: 'u2', actions: ['invoice.void'], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    );
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({ granterId: 'g1', tenantId: 't1' }));
  });

  it('serves a role detail and 404s an unknown role', async () => {
    const moduleRef = await build();
    const port = moduleRef.get<AuthzObservabilityPort>(AUTHZ_OBSERVABILITY_PORT);
    const controller = moduleRef.get(AuthzObservabilityController);
    await expect(controller.role(platformActor, 'issuer')).resolves.toMatchObject({ id: 'issuer', holderCount: 0 });
    (port.getRole as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(controller.role(platformActor, 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('routes expiring delegations and who-can through to the port', async () => {
    const moduleRef = await build();
    const port = moduleRef.get<AuthzObservabilityPort>(AUTHZ_OBSERVABILITY_PORT);
    await moduleRef.get(AuthzDelegationController).expiring(platformActor, { within: '7d', tenantId: 't1' });
    expect(port.listDelegations).toHaveBeenCalledWith(expect.objectContaining({ expiringWithinDays: 7, tenantId: 't1' }));
    await moduleRef.get(AuthzObservabilityController).whoCan(platformActor, { action: 'invoice.void', tenantId: 't1' });
    expect(port.whoCan).toHaveBeenCalledWith('invoice.void', 't1');
  });

  it('falls back to the no-op audit emitter when auditEmitterToken is omitted', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthorizationApiModule.forRoot({ actionCatalog: [], imports: [FakePortsModule] })],
    }).compile();
    expect(moduleRef.get(AUTHZ_AUDIT_EMITTER)).toBeDefined();
  });
});
