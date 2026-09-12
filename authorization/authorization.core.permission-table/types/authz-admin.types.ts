/**
 * DTOs for the authorization admin/observability surface — the answer-shapes
 * every stack adapter returns and `authorization.api` serves. Read-shaped for a
 * UI; stack-agnostic (no SQL, no ORM types).
 */

import type { DelegationStatus } from './delegation.types';

export interface RoleView {
  id: string;
  description: string | null;
  /** When true, the role grants every action and `actions` is empty. */
  grantsAll: boolean;
  actions: string[];
}

export interface UserRoleAssignment {
  userId: string;
  /** `null` = the role applies in every tenant (a platform admin). */
  tenantId: string | null;
  roleId: string;
  grantedAt: Date;
  grantedBy: string | null;
}

export interface AssignmentQuery {
  userId?: string;
  tenantId?: string | null;
  roleId?: string;
}

export interface DelegationView {
  id: string;
  granterId: string;
  granteeId: string;
  tenantId: string;
  actions: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  reason: string | null;
  createdAt: Date;
  createdBy: string;
  status: DelegationStatus;
}

export interface DelegationQuery {
  granterId?: string;
  granteeId?: string;
  tenantId?: string;
  status?: DelegationStatus;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface DelegationPage {
  delegations: DelegationView[];
  nextCursor?: string;
}

/**
 * "Can this user do X, and why." `roles` and `delegations` are the raw grants;
 * `effectiveActions` is their union (`'*'` when a `grantsAll` role is held).
 * When `action` was passed, `allowed` + `reason` explain the verdict.
 */
export interface AccessExplanation {
  userId: string;
  tenantId: string | null;
  roles: Array<{ roleId: string; grantsAll: boolean; grantedActions: string[] }>;
  delegations: Array<{ id: string; granterId: string; actions: string[]; expiresAt: Date }>;
  effectiveActions: string[] | '*';
  action?: string;
  allowed?: boolean;
  reason?: string;
}

export interface ActionCatalogHealth {
  /** In the app's `Actions` catalog but no `commons_authz_action` row — run `syncActions()`. */
  inCodeNotInDb: string[];
  /** A `commons_authz_action` row not in the passed catalog — a renamed or removed action. */
  inDbNotInCode: string[];
  /** Granted by at least one role but its `description` is still null/empty — fill in via the admin UI. */
  grantedButUndescribed: string[];
  describedCount: number;
  totalCount: number;
}

export interface AssignRoleInput {
  userId: string;
  /** `null` = grant the role in every tenant (a platform admin). */
  tenantId: string | null;
  roleId: string;
  /** Who performed the assignment — recorded in `granted_by`. */
  grantedBy: string;
}

export interface RevokeRoleInput {
  userId: string;
  tenantId: string | null;
  roleId: string;
}
