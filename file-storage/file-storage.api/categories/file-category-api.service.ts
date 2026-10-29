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
  CategoryOverrideInvalidError,
  FILE_CATEGORY_ADMIN_PORT,
  FILE_STORAGE_OBSERVABILITY_PORT,
  FILE_STORAGE_OPTIONS,
  type FileCategoryAdminPort,
  type FileCategoryView,
  type FileStorageObservabilityPort,
  type FileStorageOptions,
} from '../../file-storage.core';
import { FILE_STORAGE_API_AUDIT_EMITTER } from '../tokens';
import type { FileStorageApiAuditEmitter } from '../file-storage-audit.port';
import type { UpsertCategoryOverrideBody } from '../dto/file-storage-api.dto';

/**
 * The file-category catalog surface — the single centralized place an operator
 * sees every accepted upload type, its rules and its usage, and (for their own
 * tenant) tightens the tunable settings.
 *
 *   - reads (`file.view`)          — effective catalog + live counts.
 *   - `PATCH` / `DELETE` (`file.category.manage`) — a tenant admin edits their
 *     own tenant's override; a platform admin may target `?tenantId=` or — with
 *     no tenant — turn the base row off (`DELETE`) and back on (`PATCH { active: true }`).
 *
 * Every write is audited against the tenant it changed (`null` for the base
 * row), with the override as it was before.
 */
@Injectable()
export class FileCategoryApiService {
  constructor(
    @Inject(FILE_CATEGORY_ADMIN_PORT) private readonly port: FileCategoryAdminPort,
    @Inject(FILE_STORAGE_OBSERVABILITY_PORT) private readonly observability: FileStorageObservabilityPort,
    @Inject(FILE_STORAGE_OPTIONS) private readonly options: FileStorageOptions,
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
    if (!view) throw new NotFoundException(`no file category '${key}'`);
    return view;
  }

  async upsertOverride(actor: Actor, key: string, body: UpsertCategoryOverrideBody): Promise<FileCategoryView> {
    const tenantId = await this.writeTenant(actor, body.tenantId);
    const { tenantId: _ignored, ...input } = body;

    if (tenantId === null) return this.reactivateBase(actor, key, input);

    const before = await this.requireView(tenantId, key);
    try {
      this.assertExpiryWithinDefault(before, input.signedLinkExpirySeconds);
      const view = await this.port.upsertTenantOverride(tenantId, key, input);
      await this.audit.record({
        action: 'file.category_override_set',
        actorId: actor.id,
        tenantId,
        entityType: 'file_category',
        entityId: `${key}:${tenantId}`,
        before: before.override,
        after: view.override,
      });
      return view;
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async deactivate(actor: Actor, key: string, requestedTenantId?: string): Promise<void> {
    const tenantId = await this.writeTenant(actor, requestedTenantId);
    const before = await this.requireView(tenantId, key);
    try {
      await this.port.deactivateCategory(tenantId, key);
    } catch (e) {
      throw this.mapError(e);
    }
    await this.audit.record({
      action: 'file.category_deactivated',
      actorId: actor.id,
      tenantId,
      entityType: 'file_category',
      entityId: `${key}:${tenantId ?? 'base'}`,
      before: tenantId === null ? { active: before.base.active } : before.override,
    });
  }

  /** A platform admin's PATCH with no tenant: the base row's only writable field is `active`, and only `true` (DELETE turns it off). */
  private async reactivateBase(actor: Actor, key: string, input: Omit<UpsertCategoryOverrideBody, 'tenantId'>) {
    const fields = Object.keys(input);
    if (fields.length !== 1 || input.active !== true) {
      throw new BadRequestException(
        'a base category is edited in code — with no tenantId, PATCH only turns it back on ({ "active": true }); name a tenantId to write that tenant\'s override',
      );
    }
    const before = await this.requireView(null, key);
    const view = await this.port.activateBaseCategory(key);
    await this.audit.record({
      action: 'file.category_activated',
      actorId: actor.id,
      tenantId: null,
      entityType: 'file_category',
      entityId: `${key}:base`,
      before: { active: before.base.active },
      after: { active: true },
    });
    return view;
  }

  /**
   * A base category with no expiry of its own uses the module default — the
   * ceiling a tenant's shorter link must stay under (`assertOverrideTightens`
   * only knows the base row, not the module default).
   */
  private assertExpiryWithinDefault(view: FileCategoryView, seconds: number | null | undefined) {
    if (seconds == null) return;
    const ceiling = this.options.downloadUrlExpiry.shareableLink;
    if (view.base.signedLinkExpirySeconds === undefined && seconds > ceiling) {
      throw new CategoryLooseningNotAllowedError('signedLinkExpirySeconds');
    }
  }

  private async requireView(tenantId: string | null, key: string): Promise<FileCategoryView> {
    const view = await this.port.getCategory(tenantId, key);
    if (!view) throw new NotFoundException(`no file category '${key}'`);
    return view;
  }

  /* ─── tenant resolution ─────────────────────────────────────────────── */

  private async viewTenant(actor: Actor, requested: string | undefined): Promise<string | null> {
    if (await this.options.isPlatformAdmin(actor)) return requested ?? null;
    return actor.tenantId;
  }

  /** `null` only for a platform admin who did not name a tenant (→ the base row). */
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
    if (e instanceof CategoryOverrideInvalidError) return new UnprocessableEntityException(e.message);
    if (e instanceof CategoryNotFoundError) return new NotFoundException(e.message);
    return e as Error;
  }
}
