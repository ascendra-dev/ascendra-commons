import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException, NotImplementedException } from '@nestjs/common';
import type { Actor, Authorizer } from '../../authorization.core';
import type { AuthzObservabilityPort } from '../../authorization.core.permission-table';
import { AuthzAccessScope } from '../shared/access-scope';
import { AuthzPeopleApiService } from './authz-people-api.service';
import { InvalidDirectoryCursorError, type AuthzDirectoryUser, type AuthzUserDirectory } from './user-directory.port';

const USERS: AuthzDirectoryUser[] = [
  { id: 'ann@acme.test', name: 'Ann', tenantId: 't1' },
  { id: 'bob@acme.test', name: 'Bob', tenantId: 't1' },
  { id: 'gus@globex.test', name: 'Gus', tenantId: 't2' },
  { id: 'pat@ascendra.test', name: 'Pat', tenantId: null },
];

function deps(directory?: Partial<AuthzUserDirectory>) {
  const port = {
    listUserRoleAssignments: vi.fn().mockResolvedValue({
      assignments: [
        { userId: 'ann@acme.test', tenantId: 't1', roleId: 'member', expiresAt: null, status: 'active' },
        { userId: 'ann@acme.test', tenantId: 't2', roleId: 'member', expiresAt: null, status: 'active' },
      ],
    }),
    listDelegations: vi.fn().mockResolvedValue({ delegations: [] }),
    explainAccess: vi.fn().mockResolvedValue({ userId: 'ann@acme.test', tenantId: 't1', roles: [], delegations: [], effectiveActions: [] }),
    accessStats: vi.fn().mockResolvedValue({ tenantId: 't1', usersWithRole: 2, roleHolders: [], platformHolders: 1, activeDelegations: 0, lapsedDelegations: 0, delegationsExpiring7d: 0, assignmentsExpiring7d: 0 }),
  } as unknown as AuthzObservabilityPort;
  const dir: AuthzUserDirectory | undefined = directory && {
    listUsers: vi.fn().mockResolvedValue({ users: USERS.slice(0, 2), nextCursor: 'n' }),
    getUsers: vi.fn(async (ids: readonly string[]) => USERS.filter((u) => ids.includes(u.id))),
    countUsers: vi.fn().mockResolvedValue(5),
    ...directory,
  };
  const authorizer: Authorizer = { can: async (a: Actor, action: string) => a.id === 'p-1' && action === 'authz.platform' };
  return { port, dir, svc: new AuthzPeopleApiService(port, new AuthzAccessScope({ actionCatalog: [] }, authorizer), dir) };
}

const tenantAdmin: Actor = { id: 'admin-1', persona: 'tenant-admin', tenantId: 't1' };
const platformAdmin: Actor = { id: 'p-1', persona: 'platform-admin', tenantId: null };

describe('AuthzPeopleApiService', () => {
  it('lists a tenant’s users with the roles each actively holds there (and globally) — Rule 4', async () => {
    const { svc, dir, port } = deps({});
    const page = await svc.listUsers(tenantAdmin, { search: 'a' });
    expect(dir!.listUsers).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', search: 'a', limit: 50 }));
    expect(port.listUserRoleAssignments).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['ann@acme.test', 'bob@acme.test'], status: 'active' }));
    expect(page.meta.nextCursor).toBe('n');
    expect(page.data[0].roles).toEqual([{ roleId: 'member', tenantId: 't1', expiresAt: null }]); // not t2's
    expect(page.data[1].roles).toEqual([]);
  });

  it('refuses another tenant’s list, and 400s a bad limit or a cursor the directory never issued', async () => {
    const { svc } = deps({ listUsers: vi.fn().mockRejectedValue(new InvalidDirectoryCursorError('x')) });
    await expect(svc.listUsers(tenantAdmin, { tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.listUsers(tenantAdmin, { limit: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.listUsers(tenantAdmin, { cursor: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('looks names up within reach — own tenant and platform staff for a tenant admin, everyone for a platform admin', async () => {
    const { svc } = deps({});
    const ids = 'ann@acme.test,gus@globex.test,pat@ascendra.test,nobody';
    expect((await svc.lookup(tenantAdmin, ids)).map((u) => u.id)).toEqual(['ann@acme.test', 'pat@ascendra.test']);
    expect((await svc.lookup(platformAdmin, ids)).map((u) => u.id)).toEqual(['ann@acme.test', 'gus@globex.test', 'pat@ascendra.test']);
  });

  it('serves a profile in reach; another tenant’s user or an unknown id is a 404', async () => {
    const { svc, port } = deps({});
    const profile = await svc.profile(tenantAdmin, 'ann@acme.test');
    expect(profile.user.name).toBe('Ann');
    expect(port.explainAccess).toHaveBeenCalledWith('ann@acme.test', 't1');
    await expect(svc.profile(tenantAdmin, 'gus@globex.test')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.profile(platformAdmin, 'nobody')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 501 naming the fix when no directory is wired — stats still answer, without user counts', async () => {
    const { svc } = deps();
    await expect(svc.listUsers(tenantAdmin, {})).rejects.toBeInstanceOf(NotImplementedException);
    await expect(svc.stats(tenantAdmin, undefined)).resolves.toMatchObject({ users: null, usersWithoutRole: null, usersWithRole: 2 });
  });

  it('derives users without a role from the directory count', async () => {
    const { svc, port } = deps({});
    await expect(svc.stats(tenantAdmin, undefined)).resolves.toMatchObject({ users: 5, usersWithoutRole: 3 });
    expect(port.accessStats).toHaveBeenCalledWith('t1');
  });

  it('lists a role’s holders by name, filtered by search', async () => {
    const { svc, port } = deps({});
    (port.listUserRoleAssignments as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      assignments: [{ userId: 'bob@acme.test', roleId: 'member' }, { userId: 'ann@acme.test', roleId: 'member' }],
    });
    const page = await svc.listUsers(tenantAdmin, { roleId: 'member' });
    expect(port.listUserRoleAssignments).toHaveBeenNthCalledWith(1, expect.objectContaining({ roleId: 'member', tenantId: 't1', status: 'active' }));
    expect(page.data.map((u) => u.name)).toEqual(['Ann', 'Bob']);
    await expect(svc.listUsers(tenantAdmin, { roleId: 'member', roleless: 'true' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('walks the directory for people holding no role until the page fills', async () => {
    const listUsers = vi.fn()
      .mockResolvedValueOnce({ users: [USERS[0], USERS[1]], nextCursor: 'c1' }) // Ann holds member; Bob none
      .mockResolvedValueOnce({ users: [{ id: 'cat@acme.test', name: 'Cat', tenantId: 't1' }], nextCursor: 'c2' });
    const { svc, dir } = deps({ listUsers });
    const page = await svc.listUsers(tenantAdmin, { roleless: 'true', limit: '2' });
    expect(page.data.map((u) => u.id)).toEqual(['bob@acme.test', 'cat@acme.test']);
    expect(page.meta.nextCursor).toBe('c2');
    expect(dir!.listUsers).toHaveBeenNthCalledWith(2, expect.objectContaining({ limit: 1, cursor: 'c1' }));
  });
});
