import { Controller, Get, Inject, Query } from '@nestjs/common';
import { RequiresAction } from '../../authorization.core';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import { AuthzObservabilityApiService } from './authz-observability-api.service';
import type { DelegationStatus } from '../../authorization.core.permission-table';

/**
 * Read endpoints for a role-management / access-audit screen. All gated on
 * `authz.view` via `@RequiresAction` — `authorization.api` requires
 * `AuthorizationGuard` wired as a global `APP_GUARD` (the intended setup; see
 * `authorization.core`'s README).
 */
@Controller('authz')
export class AuthzObservabilityController {
  constructor(@Inject(AuthzObservabilityApiService) private readonly service: AuthzObservabilityApiService) {}

  @Get('roles')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  roles() {
    return this.service.listRoles();
  }

  @Get('assignments')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  assignments(
    @Query('userId') userId?: string,
    @Query('roleId') roleId?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.listAssignments({ userId, roleId, ...(tenantId !== undefined ? { tenantId } : {}) });
  }

  @Get('delegations')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  delegations(
    @Query('granterId') granterId?: string,
    @Query('granteeId') granteeId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: DelegationStatus,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listDelegations({
      granterId,
      granteeId,
      tenantId,
      status,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('explain')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  explain(
    @Query('userId') userId: string,
    @Query('tenantId') tenantId?: string,
    @Query('action') action?: string,
  ) {
    return this.service.explainAccess({ userId, tenantId: tenantId ?? null, action });
  }

  @Get('action-catalog/health')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  catalogHealth() {
    return this.service.actionCatalogHealth();
  }
}
