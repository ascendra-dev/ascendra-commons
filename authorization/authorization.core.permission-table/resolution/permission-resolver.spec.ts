import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../authorization.core';
import { PermissionResolver } from './permission-resolver';
import { runWithPermissionCache } from '../cache/permission-cache';
import type { PermissionRepository, RolePermissionSet } from '../ports/permission-repository.port';

const ACTOR: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };

function fakeRepo(opts: { roles?: RolePermissionSet; delegated?: string[] } = {}) {
  const loadRolePermissions = vi.fn(async () => opts.roles ?? { actions: [], grantsAll: false });
  const loadActiveDelegatedActions = vi.fn(async () => opts.delegated ?? []);
  return { loadRolePermissions, loadActiveDelegatedActions } satisfies PermissionRepository;
}

describe('PermissionResolver', () => {
  it('rolePermissions maps the repo set into a ResolvedPermissions', async () => {
    const repo = fakeRepo({ roles: { actions: ['invoice.view', 'invoice.void'], grantsAll: false } });
    const perms = await new PermissionResolver(repo).rolePermissions(ACTOR);

    expect(perms.grantsAll).toBe(false);
    expect([...perms.actions].sort()).toEqual(['invoice.view', 'invoice.void']);
  });

  it('rolePermissions reports grantsAll', async () => {
    const repo = fakeRepo({ roles: { actions: [], grantsAll: true } });
    const perms = await new PermissionResolver(repo).rolePermissions(ACTOR);

    expect(perms.grantsAll).toBe(true);
    expect(perms.actions.size).toBe(0);
  });

  it('effectivePermissions unions role actions with active delegated actions', async () => {
    const repo = fakeRepo({
      roles: { actions: ['invoice.view'], grantsAll: false },
      delegated: ['payment.refund'],
    });
    const perms = await new PermissionResolver(repo).effectivePermissions(ACTOR);

    expect([...perms.actions].sort()).toEqual(['invoice.view', 'payment.refund']);
  });

  it('grantsAll role short-circuits — delegated actions are not merged in', async () => {
    const repo = fakeRepo({ roles: { actions: [], grantsAll: true }, delegated: ['x'] });
    const perms = await new PermissionResolver(repo).effectivePermissions(ACTOR);

    expect(perms.grantsAll).toBe(true);
  });

  it('never queries delegations for a null-tenant actor', async () => {
    const repo = fakeRepo({ roles: { actions: ['platform.admin'], grantsAll: false } });
    await new PermissionResolver(repo).effectivePermissions({ id: 'admin', persona: 'admin', tenantId: null });

    expect(repo.loadActiveDelegatedActions).not.toHaveBeenCalled();
  });

  it('within a permission-cache scope, repeated lookups for the same actor query once', async () => {
    const repo = fakeRepo({ roles: { actions: ['invoice.view'], grantsAll: false } });
    const resolver = new PermissionResolver(repo);

    await runWithPermissionCache(async () => {
      await resolver.rolePermissions(ACTOR);
      await resolver.rolePermissions(ACTOR);
      await resolver.effectivePermissions(ACTOR);
    });

    expect(repo.loadRolePermissions).toHaveBeenCalledTimes(1);
  });

  it('without a cache scope, each lookup queries again', async () => {
    const repo = fakeRepo();
    const resolver = new PermissionResolver(repo);

    await resolver.rolePermissions(ACTOR);
    await resolver.rolePermissions(ACTOR);

    expect(repo.loadRolePermissions).toHaveBeenCalledTimes(2);
  });
});
