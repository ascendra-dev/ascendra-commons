import type {
  AccessExplanation,
  ActionCatalogHealth,
  AssignmentQuery,
  DelegationPage,
  DelegationQuery,
  RoleView,
  UserRoleAssignment,
} from '../types/authz-admin.types';

/**
 * Read-only reporting over the permission-table model for an admin screen — the
 * role catalog, who holds what, "why can/can't user X do action Y", the
 * delegation ledger, and action-catalog drift. Bound under
 * `AUTHZ_OBSERVABILITY_PORT` by a stack adapter; consumed by `authorization.api`.
 * Never mutates — writes are `AuthzAdminPort` / `DelegationService`.
 */
export interface AuthzObservabilityPort {
  /** Every role with its granted actions. */
  listRoles(): Promise<RoleView[]>;
  /** Role assignments, filtered. Implementations cap the row count — narrow the filter for a broad query. */
  listUserRoleAssignments(query?: AssignmentQuery): Promise<UserRoleAssignment[]>;
  /** "Can this user do `action` (if given), and why." */
  explainAccess(userId: string, tenantId: string | null, action?: string): Promise<AccessExplanation>;
  /** The delegation ledger, filtered, newest first, keyset-paginated. */
  listDelegations(query?: DelegationQuery): Promise<DelegationPage>;
  /** Drift between the app's `Actions` catalog and the action-catalog table. */
  actionCatalogHealth(knownActions: readonly string[]): Promise<ActionCatalogHealth>;
}
