import { describe, expect, it } from 'vitest';
import type { Actor } from '../../authorization.types';
import type { PermissionLoader, ResolvedPermissions } from './permission-loader';
import { PostgresPermissionTableAuthorizer } from './postgres-permission-table-authorizer';

const ACTOR: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };

function loaderReturning(perms: ResolvedPermissions): PermissionLoader {
  return { effectivePermissions: async () => perms } as unknown as PermissionLoader;
}

describe('PostgresPermissionTableAuthorizer', () => {
  it('can() is true for an action in the resolved set', async () => {
    const authz = new PostgresPermissionTableAuthorizer(
      loaderReturning({ grantsAll: false, actions: new Set(['invoice.view', 'invoice.void']) }),
    );
    await expect(authz.can(ACTOR, 'invoice.void')).resolves.toBe(true);
    await expect(authz.can(ACTOR, 'payment.refund')).resolves.toBe(false);
  });

  it('can() is true for everything when grantsAll', async () => {
    const authz = new PostgresPermissionTableAuthorizer(loaderReturning({ grantsAll: true, actions: new Set() }));
    await expect(authz.can(ACTOR, 'anything.at.all')).resolves.toBe(true);
  });

  it('allowedActions() returns the candidate subset that is permitted', async () => {
    const authz = new PostgresPermissionTableAuthorizer(
      loaderReturning({ grantsAll: false, actions: new Set(['invoice.view', 'invoice.void']) }),
    );
    await expect(
      authz.allowedActions(ACTOR, ['invoice.view', 'invoice.void', 'payment.refund']),
    ).resolves.toEqual(['invoice.view', 'invoice.void']);
  });

  it('allowedActions() returns every candidate when grantsAll', async () => {
    const authz = new PostgresPermissionTableAuthorizer(loaderReturning({ grantsAll: true, actions: new Set() }));
    await expect(authz.allowedActions(ACTOR, ['a', 'b', 'c'])).resolves.toEqual(['a', 'b', 'c']);
  });
});
