import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { RequiresAction, type Actor } from '../../authorization.core';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import { CurrentActor } from '../current-actor.decorator';
import { AuthzDelegationApiService } from './authz-delegation-api.service';
import type { CreateDelegationBody } from '../dto/authz-api.dto';

/**
 * Delegation create / revoke / list-mine. Gated on `authz.manage_delegations`;
 * the granter is always the request actor (`AuthzDelegationApiService`).
 * Requires `AuthorizationGuard` wired as a global `APP_GUARD`.
 */
@Controller('authz/delegations')
export class AuthzDelegationController {
  constructor(@Inject(AuthzDelegationApiService) private readonly service: AuthzDelegationApiService) {}

  @Post()
  @RequiresAction(AUTHZ_ACTIONS.MANAGE_DELEGATIONS)
  create(@CurrentActor() actor: Actor, @Body() body: CreateDelegationBody) {
    return this.service.create(actor, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequiresAction(AUTHZ_ACTIONS.MANAGE_DELEGATIONS)
  revoke(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.revoke(actor, id);
  }

  @Get('mine')
  @RequiresAction(AUTHZ_ACTIONS.MANAGE_DELEGATIONS)
  mine(@CurrentActor() actor: Actor) {
    return this.service.listMine(actor);
  }
}
