import type { FileCategoryOverrideInput, FileCategoryView } from './file-storage-admin.types';

/**
 * The admin surface over the file-category catalog. Bound under
 * `FILE_CATEGORY_ADMIN_PORT` by a stack adapter; consumed by `file-storage.api`.
 *
 * Base definitions are never created or edited here — they are seeded at
 * deploy time. This port only:
 *   - lists / reads the effective catalog for a tenant,
 *   - upserts a tenant's *override* (tightening only — `CategoryLooseningNotAllowedError`),
 *   - deactivates: a tenant's own override (revert to base), or — for a
 *     platform admin (`tenantId === null`) — the base row (soft-delete),
 *   - reactivates a deactivated base row (platform admin).
 */
export interface FileCategoryAdminPort {
  listCategories(tenantId: string | null): Promise<FileCategoryView[]>;

  getCategory(tenantId: string | null, key: string): Promise<FileCategoryView | null>;

  /** Throws `CategoryNotFoundError` when no base row has this key, `CategoryLooseningNotAllowedError` / `CategoryOverrideInvalidError` for a bad value. */

  upsertTenantOverride(
    tenantId: string,
    key: string,
    input: FileCategoryOverrideInput,
  ): Promise<FileCategoryView>;

  /** Throws `CategoryNotFoundError` when no base row has this key — never writes a stray override. */
  deactivateCategory(tenantId: string | null, key: string): Promise<void>;

  /** Platform only: turn a deactivated base category back on. Throws `CategoryNotFoundError` for an unknown key. */
  activateBaseCategory(key: string): Promise<FileCategoryView>;
}

export const FILE_CATEGORY_ADMIN_PORT = Symbol('FILE_CATEGORY_ADMIN_PORT');
