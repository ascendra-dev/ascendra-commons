import type { DelegationStatus } from '../../authorization.core.permission-table';

/**
 * Request shapes for `authorization.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. Controllers apply the light structural checks
 * they need (`assertNonEmptyString`, date parsing) and the `.api` services apply
 * the actor-scoped rules.
 */

export interface AssignRoleBody {
  userId: string;
  /** `null` = grant in every tenant (platform admin only). */
  tenantId: string | null;
  roleId: string;
}

export interface RevokeRoleBody {
  userId: string;
  tenantId: string | null;
  roleId: string;
}

export interface SetActionDescriptionBody {
  description: string | null;
}

export interface CreateDelegationBody {
  granteeId: string;
  /** Omit to use the caller's own tenant; if given it must equal the caller's tenant. */
  tenantId?: string;
  actions: string[];
  /** ISO-8601. */
  expiresAt: string;
  reason?: string;
}

export interface AssignmentListQuery {
  userId?: string;
  tenantId?: string | null;
  roleId?: string;
}

export interface DelegationListQuery {
  granterId?: string;
  granteeId?: string;
  tenantId?: string;
  status?: DelegationStatus;
  limit?: number;
  cursor?: string;
}

export interface ExplainAccessQuery {
  userId: string;
  tenantId: string | null;
  action?: string;
}
