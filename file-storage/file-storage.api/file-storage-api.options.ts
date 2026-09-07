import type { DynamicModule } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';

/**
 * The `@RequiresAction` gate names `file-storage.api`'s endpoints declare.
 * Fixed (not `forRoot`-configurable) — `@RequiresAction` is applied at
 * class-definition time. A vertical whose catalog uses different names maps its
 * admin role to *also* grant these.
 */
export const FILE_STORAGE_ACTIONS = {
  /** Read the file inventory, one file, its access log, storage usage, orphans, the category catalog. */
  VIEW: 'file.view',
  /** Delete a file, detach an attachment. */
  DELETE: 'file.delete',
  /** Edit / deactivate a file category (tenant override, or — platform admin — the base row). */
  MANAGE_CATEGORY: 'file.category.manage',
} as const;

export interface FileStorageApiModuleConfig {
  /**
   * Modules exporting `FILE_STORAGE_OBSERVABILITY_PORT` +
   * `FILE_CATEGORY_ADMIN_PORT` (from `file-storage.core.postgres-drizzle`) and
   * `AttachmentService` (from `FileStorageModule.forRoot`).
   */
  imports?: DynamicModule['imports'];
  /** Optional token a `FileStorageApiAuditEmitter` is provided under. Omit → the destructive ops are not audited here. */
  auditEmitterToken?: string | symbol | (new (...args: never[]) => unknown);
  /**
   * Is this actor a platform admin — sees every tenant's files, may edit the
   * base category row? Default: `actor.tenantId === null`.
   */
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
}

/** The shape bound under `FILE_STORAGE_API_OPTIONS`. */
export interface FileStorageApiOptions {
  isPlatformAdmin: (actor: Actor) => boolean | Promise<boolean>;
}

export function resolveFileStorageApiOptions(config: FileStorageApiModuleConfig): FileStorageApiOptions {
  return {
    isPlatformAdmin: config.isPlatformAdmin ?? ((actor) => actor.tenantId === null),
  };
}
