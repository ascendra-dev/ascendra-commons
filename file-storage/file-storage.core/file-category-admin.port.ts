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
 *     platform admin (`tenantId === null`) — the base row (soft-delete).
 */
export interface FileCategoryAdminPort {
  listCategories(tenantId: string | null): Promise<FileCategoryView[]>;

  getCategory(tenantId: string | null, key: string): Promise<FileCategoryView | null>;

  upsertTenantOverride(
    tenantId: string,
    key: string,
    input: FileCategoryOverrideInput,
  ): Promise<FileCategoryView>;

  deactivateCategory(tenantId: string | null, key: string): Promise<void>;
}

export const FILE_CATEGORY_ADMIN_PORT = Symbol('FILE_CATEGORY_ADMIN_PORT');
