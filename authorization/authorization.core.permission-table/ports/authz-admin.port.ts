import type { AssignRoleInput, RevokeRoleInput } from '../types/authz-admin.types';

/**
 * The narrow set of authorization mutations an admin screen needs. Bound under
 * `AUTHZ_ADMIN_PORT` by a stack adapter; consumed by `authorization.api`.
 *
 * Role→permission editing is deliberately **not** here — that's platform-admin
 * territory, changed by migration/seed, typically `REVOKE`d from the app DB role
 * (see the adapter README). Delegation create/revoke lives in `DelegationService`.
 *
 * Implementations raise `RoleNotFoundError` / `ActionNotFoundError` from
 * `authz-admin.errors.ts`.
 */
export interface AuthzAdminPort {
  /** Idempotent — assigning a role the user already holds (same tenant) is a no-op. */
  assignRole(input: AssignRoleInput): Promise<void>;
  /** Idempotent — revoking a role the user doesn't hold is a no-op. */
  revokeRole(input: RevokeRoleInput): Promise<void>;
  /** Fill in (or clear) the free-text description of a catalog action. */
  setActionDescription(action: string, description: string | null): Promise<void>;
}
