import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FileQuotaApiService } from './file-quota-api.service';
import { resolveFileStorageOptions } from '../../file-storage.core';

const tenantAdmin = { id: 'ta', persona: 'ops', tenantId: 't1' };
const platformAdmin = { id: 'pa', persona: 'ops', tenantId: null };
const q = (maxBytes: number) => ({ tenantId: 't4', maxBytes, updatedAt: new Date(), updatedBy: 'pa' });

function make(over: { existing?: ReturnType<typeof q> | null; removed?: ReturnType<typeof q> | null } = {}) {
  const quotas = {
    getQuota: vi.fn().mockResolvedValue(over.existing ?? null),
    usage: vi.fn(),
    setQuota: vi.fn(async (_t: string, maxBytes: number) => q(maxBytes)),
    clearQuota: vi.fn().mockResolvedValue('removed' in over ? over.removed : q(10)),
    listQuotas: vi.fn().mockResolvedValue([]),
  };
  const audit = { record: vi.fn() };
  return { svc: new FileQuotaApiService(quotas, resolveFileStorageOptions({}), audit), quotas, audit };
}

describe('FileQuotaApiService', () => {
  it('a tenant admin sees only their own limit, a platform admin any', async () => {
    const { svc, quotas } = make();
    await svc.list(tenantAdmin, 't9');
    await svc.list(platformAdmin, 't9');
    expect(quotas.listQuotas.mock.calls).toEqual([['t1'], ['t9']]);
  });

  it('only a platform admin sets or removes a limit', async () => {
    const { svc, quotas } = make();
    await expect(svc.set(tenantAdmin, 't1', 10)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.clear(tenantAdmin, 't1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(quotas.setQuota).not.toHaveBeenCalled();
  });

  it('audits a change with before and after, against the tenant', async () => {
    const { svc, audit } = make({ existing: q(500) });
    await svc.set(platformAdmin, 't4', 1000);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.quota_set', tenantId: 't4', before: { maxBytes: 500 }, after: { maxBytes: 1000 } }));
  });

  it('removing a limit that is not there is a 404', async () => {
    await expect(make({ removed: null }).svc.clear(platformAdmin, 't4')).rejects.toBeInstanceOf(NotFoundException);
  });
});
