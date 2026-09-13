import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { RequiresAction } from '../../authorization.core';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import { AuthzObservabilityApiService } from './authz-observability-api.service';
import type { DelegationStatus } from '../../authorization.core.permission-table';

/** Parses `?within=7d` (or a bare `7`) into a day count. Defaults to 7 when omitted. */
function parseWithinDays(within: string | undefined): number {
  if (within === undefined) return 7;
  const match = /^(\d+)\s*d?$/i.exec(within.trim());
  if (!match) throw new BadRequestException("within must look like '7d'");
  return Number(match[1]);
}

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

  @Get('roles/:id')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  role(@Param('id') id: string) {
    return this.service.getRole(id);
  }

  @Get('delegations/expiring')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  expiringDelegations(@Query('within') within?: string, @Query('tenantId') tenantId?: string) {
    return this.service.listDelegations({
      expiringWithinDays: parseWithinDays(within),
      ...(tenantId !== undefined ? { tenantId } : {}),
    });
  }

  @Get('who-can')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  whoCan(@Query('action') action: string, @Query('tenantId') tenantId?: string) {
    return this.service.whoCan({ action, tenantId });
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
