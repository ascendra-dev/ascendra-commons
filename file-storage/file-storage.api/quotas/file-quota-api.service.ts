import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  FILE_STORAGE_OPTIONS,
  STORAGE_QUOTA_STORE,
  type FileStorageOptions,
  type StorageQuotaStore,
} from '../../file-storage.core';
import { FILE_STORAGE_API_AUDIT_EMITTER } from '../tokens';
import type { FileStorageApiAuditEmitter } from '../file-storage-audit.port';

/**
 * Per-tenant storage limits. Reads are tenant-scoped (a tenant admin sees
 * their own); setting or removing a limit is a platform admin's — a tenant
 * can't raise its own. Writes audited against the tenant they touch.
 */
@Injectable()
export class FileQuotaApiService {
  constructor(
    @Inject(STORAGE_QUOTA_STORE) private readonly quotas: StorageQuotaStore,
    @Inject(FILE_STORAGE_OPTIONS) private readonly options: FileStorageOptions,
    @Inject(FILE_STORAGE_API_AUDIT_EMITTER) private readonly audit: FileStorageApiAuditEmitter,
  ) {}

  /** Platform: every limit (or one tenant's). Tenant: their own — `data` empty when they have none. */
  async list(actor: Actor, requestedTenantId?: string) {
    if (await this.options.isPlatformAdmin(actor)) return this.quotas.listQuotas(requestedTenantId);
    if (actor.tenantId === null) throw new ForbiddenException('no tenant context');
    return this.quotas.listQuotas(actor.tenantId);
  }

  async set(actor: Actor, tenantId: string, maxBytes: number) {
    await this.requirePlatform(actor);
    const before = await this.quotas.getQuota(tenantId);
    const after = await this.quotas.setQuota(tenantId, maxBytes, actor.id);
    await this.audit.record({
      action: 'file.quota_set',
      actorId: actor.id,
      tenantId,
      entityType: 'file_quota',
      entityId: tenantId,
      before: before ? { maxBytes: before.maxBytes } : null,
      after: { maxBytes: after.maxBytes },
    });
    return after;
  }

  async clear(actor: Actor, tenantId: string): Promise<void> {
    await this.requirePlatform(actor);
    const removed = await this.quotas.clearQuota(tenantId);
    if (!removed) throw new NotFoundException(`tenant '${tenantId}' has no storage limit`);
    await this.audit.record({
      action: 'file.quota_cleared',
      actorId: actor.id,
      tenantId,
      entityType: 'file_quota',
      entityId: tenantId,
      before: { maxBytes: removed.maxBytes },
    });
  }

  private async requirePlatform(actor: Actor): Promise<void> {
    if (!(await this.options.isPlatformAdmin(actor))) {
      throw new ForbiddenException("a tenant's storage limit is set by the platform — platform admins only");
    }
  }
}
