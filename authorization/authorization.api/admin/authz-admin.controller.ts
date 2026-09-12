import { Body, Controller, Delete, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { RequiresAction, type Actor } from '../../authorization.core';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import { CurrentActor } from '../current-actor.decorator';
import { AuthzAdminApiService } from './authz-admin-api.service';
import type { AssignRoleBody, RevokeRoleBody, SetActionDescriptionBody } from '../dto/authz-api.dto';

/**
 * Role-assignment + catalog-description mutations. Assignment is gated on
 * `authz.assign_roles` and tenant/role-ceiling-scoped to the request actor in
 * `AuthzAdminApiService`; catalog editing is gated on `authz.manage_catalog`.
 * Requires `AuthorizationGuard` wired as a global `APP_GUARD`.
 */
@Controller('authz')
export class AuthzAdminController {
  constructor(@Inject(AuthzAdminApiService) private readonly service: AuthzAdminApiService) {}

  @Post('assignments')
  @HttpCode(204)
  @RequiresAction(AUTHZ_ACTIONS.ASSIGN_ROLES)
  assign(@CurrentActor() actor: Actor, @Body() body: AssignRoleBody) {
    return this.service.assignRole(actor, body);
  }

  @Delete('assignments')
  @HttpCode(204)
  @RequiresAction(AUTHZ_ACTIONS.ASSIGN_ROLES)
  revoke(@CurrentActor() actor: Actor, @Body() body: RevokeRoleBody) {
    return this.service.revokeRole(actor, body);
  }

  @Patch('actions/:name')
  @HttpCode(204)
  @RequiresAction(AUTHZ_ACTIONS.MANAGE_CATALOG)
  describeAction(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    @Body() body: SetActionDescriptionBody,
  ) {
    return this.service.setActionDescription(actor, name, body.description ?? null);
  }
}
