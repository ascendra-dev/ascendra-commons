import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthorizationModule, AUTHORIZER, computeSessionSnapshot } from '../authorization.core';
import type { Authorizer } from '../authorization.core';
import { permissionTableProviders } from './permission-table.providers';
import { DelegationService } from './delegation/delegation.service';
import type { PermissionRepository } from './ports/permission-repository.port';
import type { DelegationRepository } from './ports/delegation-repository.port';
import {
  AUTHZ_DELEGATION_SERVICE,
  DELEGATION_REPOSITORY,
  PERMISSION_REPOSITORY,
  PERMISSION_TABLE_AUTHORIZER,
} from './tokens';

/**
 * Boots a real container with `permissionTableProviders()` on top of fake
 * repositories — the same shape a stack adapter's module produces, proving the
 * family half of a Model 2 wiring resolves for real (not just typechecks).
 */
const loadRolePermissions = vi.fn(async () => ({ actions: ['invoice.view'], grantsAll: false }));
const loadActiveDelegatedActions = vi.fn(async () => [] as string[]);

@Module({
  providers: [
    {
      provide: PERMISSION_REPOSITORY,
      useValue: { loadRolePermissions, loadActiveDelegatedActions } satisfies PermissionRepository,
    },
    {
      provide: DELEGATION_REPOSITORY,
      useValue: {
        insert: vi.fn(),
        revoke: vi.fn(),
        listForActor: vi.fn(async () => []),
      } satisfies DelegationRepository,
    },
    ...permissionTableProviders({ maxDelegationDays: 30 }),
  ],
  exports: [PERMISSION_TABLE_AUTHORIZER, AUTHZ_DELEGATION_SERVICE],
})
class FakePermissionTableModule {}

describe('permissionTableProviders — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [
        AuthorizationModule.forRoot({
          authorizerToken: PERMISSION_TABLE_AUTHORIZER,
          imports: [FakePermissionTableModule],
        }),
      ],
    }).compile();
  }

  it('binds AUTHORIZER to the permission-table authorizer, reaching the repository', async () => {
    const moduleRef = await build();
    const authorizer = moduleRef.get<Authorizer>(AUTHORIZER);

    await expect(authorizer.can({ id: 'u1', persona: 'issuer', tenantId: 't1' }, 'invoice.view')).resolves.toBe(true);
    expect(loadRolePermissions).toHaveBeenCalled();
    await moduleRef.close();
  });

  it('the bound authorizer implements allowedActions, so computeSessionSnapshot takes the one-query path', async () => {
    const moduleRef = await build();
    const authorizer = moduleRef.get<Authorizer>(AUTHORIZER);

    const snap = await computeSessionSnapshot(
      { id: 'u1', persona: 'issuer', tenantId: 't1' },
      ['invoice.view', 'invoice.void'],
      authorizer,
    );
    expect(snap.allowedActions).toEqual(['invoice.view']);
    await moduleRef.close();
  });

  it('exports the delegation service', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(AUTHZ_DELEGATION_SERVICE)).toBeInstanceOf(DelegationService);
    await moduleRef.close();
  });
});
