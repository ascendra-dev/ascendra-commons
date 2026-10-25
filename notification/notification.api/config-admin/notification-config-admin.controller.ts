import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { NOTIFICATION_ACTIONS } from '../notification-api.options';
import { NotificationConfigAdminApiService } from './notification-config-admin-api.service';
import type {
  DeleteChannelRouteBody,
  DeleteProviderCredentialBody,
  DeleteTemplateBody,
  PreviewTemplateBody,
  SetChannelRouteBody,
  SetProviderCredentialBody,
  SetTemplateBody,
} from '../dto/notification-api.dto';

/**
 * CRUD on routing / template / provider-credential rows. `list*` reads are gated
 * on `notification.view`; writes on `notification.manage_config` and
 * tenant-ceiling-scoped to the request actor in the service. Requires
 * `AuthorizationGuard` wired globally as `APP_GUARD` — and fails closed without it (`AuthorizationEnforcedGuard`).
 */
@Controller('notifications/config')
@UseGuards(AuthorizationEnforcedGuard)
export class NotificationConfigAdminController {
  constructor(
    @Inject(NotificationConfigAdminApiService) private readonly service: NotificationConfigAdminApiService,
  ) {}

  // routes

  @Get('routes')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  listRoutes() {
    return this.service.listChannelRoutes();
  }

  @Put('routes')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  setRoute(@CurrentActor() actor: Actor, @Body() body: SetChannelRouteBody) {
    return this.service.setChannelRoute(actor, body);
  }

  @Delete('routes')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  deleteRoute(@CurrentActor() actor: Actor, @Body() body: DeleteChannelRouteBody) {
    return this.service.deleteChannelRoute(actor, body);
  }

  // templates

  @Get('templates')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  listTemplates() {
    return this.service.listTemplates();
  }

  @Put('templates')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  setTemplate(@CurrentActor() actor: Actor, @Body() body: SetTemplateBody) {
    return this.service.setTemplate(actor, body);
  }

  @Delete('templates')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  deleteTemplate(@CurrentActor() actor: Actor, @Body() body: DeleteTemplateBody) {
    return this.service.deleteTemplate(actor, body);
  }

  @Post('templates/preview')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  previewTemplate(@Body() body: PreviewTemplateBody) {
    return this.service.previewTemplate(body);
  }

  // credentials (values never returned)

  @Get('credentials')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  listCredentials() {
    return this.service.listProviderCredentials();
  }

  @Put('credentials')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  setCredential(@CurrentActor() actor: Actor, @Body() body: SetProviderCredentialBody) {
    return this.service.setProviderCredential(actor, body);
  }

  @Delete('credentials')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  deleteCredential(@CurrentActor() actor: Actor, @Body() body: DeleteProviderCredentialBody) {
    return this.service.deleteProviderCredential(actor, body);
  }
}
