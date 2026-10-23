import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotImplementedException } from '@nestjs/common';
import type { Actor, Authorizer } from '../../authorization.core';
import type { AccessDenialObservabilityPort } from '../../authorization.core.permission-table';
import { AuthzAccessScope } from '../shared/access-scope';
import { AuthzDenialsApiService } from './authz-denials-api.service';

const authorizer: Authorizer = { can: async (a: Actor, action: string) => a.id === 'p-1' && action === 'authz.platform' };
const scope = new AuthzAccessScope({ actionCatalog: [] }, authorizer);
const port = (): AccessDenialObservabilityPort => ({
  listDenials: vi.fn().mockResolvedValue({ denials: [], nextCursor: 'c' }),
  denialSummary: vi.fn().mockResolvedValue({ total: 0, actors: 0, topActions: [], topActors: [] }),
});
const tenantAdmin: Actor = { id: 'admin-1', persona: 'tenant-admin', tenantId: 't1' };

describe('AuthzDenialsApiService', () => {
  it("scopes a tenant admin to its own tenant's denials, Rule 4", async () => {
    const p = port();
    const svc = new AuthzDenialsApiService(scope, p);
    await expect(svc.list(tenantAdmin, {})).resolves.toEqual({ data: [], meta: { nextCursor: 'c' } });
    expect(p.listDenials).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    await expect(svc.list(tenantAdmin, { tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
    await svc.summary(tenantAdmin, {});
    expect(p.denialSummary).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
  });

  it('400s a bad date or limit; 501s naming the fix when the log is not wired', async () => {
    const svc = new AuthzDenialsApiService(scope, port());
    await expect(svc.list(tenantAdmin, { since: 'yesterday' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.list(tenantAdmin, { limit: '0' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(new AuthzDenialsApiService(scope).list(tenantAdmin, {})).rejects.toBeInstanceOf(NotImplementedException);
  });
});
