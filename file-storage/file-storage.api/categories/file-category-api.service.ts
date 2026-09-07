import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  CategoryLooseningNotAllowedError,
  CategoryNotFoundError,
  FILE_CATEGORY_ADMIN_PORT,
  FILE_STORAGE_OBSERVABILITY_PORT,
  type FileCategoryAdminPort,
  type FileStorageObservabilityPort,
} from '../../file-storage.core';
import { FILE_STORAGE_API_AUDIT_EMITTER, FILE_STORAGE_API_OPTIONS } from '../tokens';
import type { FileStorageApiAuditEmitter } from '../file-storage-audit.port';
import type { FileStorageApiOptions } from '../file-storage-api.options';
import type { UpsertCategoryOverrideBody } from '../dto/file-storage-api.dto';

/**
 * The file-category catalog surface — the single centralized place an operator
 * sees every accepted upload type, its rules and its usage, and (for their own
 * tenant) tightens the tunable settings.
 *
 *   - reads (`file.view`)          — effective catalog + live counts.
 *   - `PATCH` / `DELETE` (`file.category.manage`) — a tenant admin edits their
 *     own tenant's override; a platform admin may target `?tenantId=` or, on
 *     `DELETE`, the base row.
 */
@Injectable()
export class FileCategoryApiService {
  constructor(
    @Inject(FILE_CATEGORY_ADMIN_PORT) private readonly port: FileCategoryAdminPort,
    @Inject(FILE_STORAGE_OBSERVABILITY_PORT) private readonly observability: FileStorageObservabilityPort,
    @Inject(FILE_STORAGE_API_OPTIONS) private readonly options: FileStorageApiOptions,
    @Inject(FILE_STORAGE_API_AUDIT_EMITTER) private readonly audit: FileStorageApiAuditEmitter,
  ) {}

  async listCategories(actor: Actor, requestedTenantId?: string) {
    const tenantId = await this.viewTenant(actor, requestedTenantId);
    const [views, usage] = await Promise.all([
      this.port.listCategories(tenantId),
      this.observability.categoryUsage(tenantId ?? undefined),
    ]);
    const byKey = new Map(usage.map((u) => [u.key, u]));
    return views.map((v) => ({
      ...v,
      usage: byKey.get(v.key) ?? { key: v.key, fileCount: 0, totalBytes: 0, lastUploadedAt: null },
    }));
  }

  async getCategory(actor: Actor, key: string, requestedTenantId?: string) {
    const view = await this.port.getCategory(await this.viewTenant(actor, requestedTenantId), key);
    if (!view) throw new NotFoundException();
    return view;
  }

  async upsertOverride(actor: Actor, key: string, body: UpsertCategoryOverrideBody) {
    const tenantId = await this.writeTenant(actor, body.tenantId);
    if (tenantId === null) {
      throw new BadRequestException('a category override is always per-tenant — supply tenantId (platform admin) or call as a tenant admin');
    }
    const { tenantId: _ignored, ...input } = body;
    try {
      const view = await this.port.upsertTenantOverride(tenantId, key, input);
      await this.audit.record({
        action: 'file.category_override_set',
        actorId: actor.id,
        tenantId,
        entityType: 'file_category',
        entityId: `${key}:${tenantId}`,
        after: input,
      });
      return view;
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async deactivate(actor: Actor, key: string, requestedTenantId?: string): Promise<void> {
    const tenantId = await this.writeTenant(actor, requestedTenantId);
    try {
      await this.port.deactivateCategory(tenantId, key);
    } catch (e) {
      throw this.mapError(e);
    }
    await this.audit.record({
      action: 'file.category_deactivated',
      actorId: actor.id,
      tenantId: actor.tenantId,
      entityType: 'file_category',
      entityId: `${key}:${tenantId ?? 'base'}`,
    });
  }

  /* ─── tenant resolution ─────────────────────────────────────────────── */

  private async viewTenant(actor: Actor, requested: string | undefined): Promise<string | null> {
    if (await this.options.isPlatformAdmin(actor)) return requested ?? null;
    return actor.tenantId;
  }

  /** `null` only for a platform admin who did not name a tenant (→ the base row, `DELETE` only). */
  private async writeTenant(actor: Actor, requested: string | undefined): Promise<string | null> {
    if (await this.options.isPlatformAdmin(actor)) return requested ?? null;
    if (!actor.tenantId) throw new ForbiddenException('no tenant context');
    if (requested && requested !== actor.tenantId) {
      throw new ForbiddenException("cannot edit another tenant's category settings");
    }
    return actor.tenantId;
  }

  private mapError(e: unknown): Error {
    if (e instanceof CategoryLooseningNotAllowedError) return new UnprocessableEntityException(e.message);
    if (e instanceof CategoryNotFoundError) return new NotFoundException(e.message);
    return e as Error;
  }
}
