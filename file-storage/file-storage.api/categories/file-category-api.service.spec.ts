import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FileCategoryApiService } from './file-category-api.service';
import { CategoryLooseningNotAllowedError, CategoryOverrideInvalidError, resolveFileStorageOptions } from '../../file-storage.core';
import type { Actor } from '../../../authorization/authorization.core';

const tenantAdmin: Actor = { id: 'ta', persona: 'ops', tenantId: 't1' };
const platformAdmin: Actor = { id: 'pa', persona: 'ops', tenantId: null };

function make(portOver: Record<string, unknown> = {}) {
  const port = {
    listCategories: vi.fn().mockResolvedValue([{ key: 'kyc', base: {}, override: null, effective: {} }]),
    getCategory: vi.fn().mockResolvedValue({ key: 'kyc', base: {}, override: null, effective: {} }),
    upsertTenantOverride: vi.fn().mockResolvedValue({ key: 'kyc' }),
    deactivateCategory: vi.fn().mockResolvedValue(undefined),
    activateBaseCategory: vi.fn().mockResolvedValue({ key: 'kyc' }),
    ...portOver,
  };
  const observability = { categoryUsage: vi.fn().mockResolvedValue([{ key: 'kyc', fileCount: 3, totalBytes: 99, lastUploadedAt: null }]) };
  const audit = { record: vi.fn() };
  const svc = new FileCategoryApiService(
    port as never,
    observability as never,
    resolveFileStorageOptions({}),
    audit as never,
  );
  return { svc, port, observability, audit };
}

describe('FileCategoryApiService', () => {
  it('merges live usage counts into the catalog list', async () => {
    const { svc } = make();
    const list = await svc.listCategories(tenantAdmin);
    expect(list[0].usage).toEqual({ key: 'kyc', fileCount: 3, totalBytes: 99, lastUploadedAt: null });
  });

  it('a tenant admin scopes reads to their own tenant', async () => {
    const { svc, port } = make();
    await svc.listCategories(tenantAdmin, 't2');
    expect(port.listCategories).toHaveBeenCalledWith('t1');
  });

  it('upsert writes the caller tenant override and audits it', async () => {
    const { svc, port, audit } = make();
    await svc.upsertOverride(tenantAdmin, 'kyc', { maxSizeBytes: 1000 });
    expect(port.upsertTenantOverride).toHaveBeenCalledWith('t1', 'kyc', { maxSizeBytes: 1000 });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.category_override_set' }));
  });

  it('a tenant admin cannot target another tenant', async () => {
    const { svc } = make();
    await expect(svc.upsertOverride(tenantAdmin, 'kyc', { tenantId: 't2', maxSizeBytes: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maps a loosening attempt to 422', async () => {
    const { svc } = make({ upsertTenantOverride: vi.fn().mockRejectedValue(new CategoryLooseningNotAllowedError('maxSizeBytes')) });
    await expect(svc.upsertOverride(tenantAdmin, 'kyc', { maxSizeBytes: 9e9 })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('getCategory 404s when the port returns null', async () => {
    const { svc } = make({ getCategory: vi.fn().mockResolvedValue(null) });
    await expect(svc.getCategory(tenantAdmin, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a platform admin deactivating without tenantId targets the base row', async () => {
    const { svc, port } = make();
    await svc.deactivate(platformAdmin, 'kyc');
    expect(port.deactivateCategory).toHaveBeenCalledWith(null, 'kyc');
  });

  it('maps a value that cannot be a rule to 422', async () => {
    const { svc } = make({ upsertTenantOverride: vi.fn().mockRejectedValue(new CategoryOverrideInvalidError('maxSizeBytes', 'must be at least 1')) });
    await expect(svc.upsertOverride(tenantAdmin, 'kyc', { maxSizeBytes: 0 })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('a base with no expiry of its own caps a tenant link at the module default', async () => {
    const { svc, port } = make({ getCategory: vi.fn().mockResolvedValue({ key: 'kyc', base: {}, override: null, effective: {} }) });
    await expect(svc.upsertOverride(tenantAdmin, 'kyc', { signedLinkExpirySeconds: 86_400 })).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(port.upsertTenantOverride).not.toHaveBeenCalled();
    await svc.upsertOverride(tenantAdmin, 'kyc', { signedLinkExpirySeconds: 600 });
    expect(port.upsertTenantOverride).toHaveBeenCalled();
  });

  it('audits an override with what it was before and after, against the target tenant', async () => {
    const { svc, audit } = make({
      getCategory: vi.fn().mockResolvedValue({ key: 'kyc', base: {}, override: { maxSizeBytes: 5000, active: true }, effective: {} }),
      upsertTenantOverride: vi.fn().mockResolvedValue({ key: 'kyc', override: { maxSizeBytes: 1000, active: true } }),
    });
    await svc.upsertOverride(platformAdmin, 'kyc', { tenantId: 't4', maxSizeBytes: 1000 });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't4',
      before: { maxSizeBytes: 5000, active: true },
      after: { maxSizeBytes: 1000, active: true },
    }));
  });

  it('404s an unknown key before writing anything', async () => {
    const { svc, port } = make({ getCategory: vi.fn().mockResolvedValue(null) });
    await expect(svc.upsertOverride(tenantAdmin, 'nope', { maxSizeBytes: 1 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deactivate(tenantAdmin, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(port.upsertTenantOverride).not.toHaveBeenCalled();
    expect(port.deactivateCategory).not.toHaveBeenCalled();
  });

  it('a platform admin with no tenant turns the base back on with { active: true } — and nothing else', async () => {
    const { svc, port, audit } = make();
    await svc.upsertOverride(platformAdmin, 'kyc', { active: true });
    expect(port.activateBaseCategory).toHaveBeenCalledWith('kyc');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.category_activated', tenantId: null }));
    await expect(svc.upsertOverride(platformAdmin, 'kyc', { maxSizeBytes: 1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertOverride(platformAdmin, 'kyc', { active: false })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("deactivating the base audits tenant null with the base's previous state", async () => {
    const { svc, audit } = make({ getCategory: vi.fn().mockResolvedValue({ key: 'kyc', base: { active: true }, override: null, effective: {} }) });
    await svc.deactivate(platformAdmin, 'kyc');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null, entityId: 'kyc:base', before: { active: true } }));
  });
});
