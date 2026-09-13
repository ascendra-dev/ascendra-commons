import type {
  AccessExplanation,
  ActionCatalogHealth,
  AssignmentQuery,
  DelegationPage,
  DelegationQuery,
  RoleView,
  UserRoleAssignment,
  WhoCanResult,
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
  /** One role by id, or `null` if it doesn't exist. */
  getRole(id: string): Promise<RoleView | null>;
  /** How many `commons_authz_user_role` rows hold this role (0 if the role doesn't exist or nobody holds it). */
  countHolders(roleId: string): Promise<number>;
  /** Role assignments, filtered. Implementations cap the row count — narrow the filter for a broad query. */
  listUserRoleAssignments(query?: AssignmentQuery): Promise<UserRoleAssignment[]>;
  /** "Can this user do `action` (if given), and why." */
  explainAccess(userId: string, tenantId: string | null, action?: string): Promise<AccessExplanation>;
  /** The delegation ledger, filtered, newest first, keyset-paginated. */
  listDelegations(query?: DelegationQuery): Promise<DelegationPage>;
  /** Drift between the app's `Actions` catalog and the action-catalog table. */
  actionCatalogHealth(knownActions: readonly string[]): Promise<ActionCatalogHealth>;
  /** The reverse of `explainAccess` — every role and active delegation that grants `action`, plus holders, scoped to `tenantId` when given. */
  whoCan(action: string, tenantId?: string): Promise<WhoCanResult>;
}
