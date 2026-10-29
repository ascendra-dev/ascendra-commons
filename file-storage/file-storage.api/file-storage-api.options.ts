import type { DynamicModule } from '@nestjs/common';

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
   * `AttachmentService` + `FILE_STORAGE_OPTIONS` (from `FileStorageModule.forRoot`).
   * Who counts as a platform admin is `FileStorageModule.forRoot({ isPlatformAdmin })`
   * — one setting for the handler and the console, so the two can't disagree.
   */
  imports?: DynamicModule['imports'];
  /** Optional token a `FileStorageApiAuditEmitter` is provided under. Omit → the destructive ops are not audited here. */
  auditEmitterToken?: string | symbol | (new (...args: never[]) => unknown);
}
