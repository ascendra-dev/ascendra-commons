import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  NOTIFICATION_CONFIG_ADMIN_PORT,
  type NotificationConfigAdminPort,
} from '../../notification.core.database';
import { NOTIFICATION_API_OPTIONS, NOTIFICATION_AUDIT_EMITTER } from '../tokens';
import type { NotificationApiOptions } from '../notification-api.options';
import type { NotificationAuditEmitter } from '../notification-audit.port';
import type {
  DeleteChannelRouteBody,
  DeleteProviderCredentialBody,
  DeleteTemplateBody,
  SetChannelRouteBody,
  SetProviderCredentialBody,
  SetTemplateBody,
} from '../dto/notification-api.dto';

/**
 * The actor-scoped rules `@RequiresAction('notification.manage_config')` can't
 * express, plus audit emission:
 *
 *  - A non-platform admin may only touch rows for **their own tenant** — a
 *    `null` tenantId (deployment default) or a different tenant is rejected.
 *  - Each mutation emits a `NotificationAuditEvent` through the optional emitter.
 *  - Reads (`list*`) are unscoped — the whole config is visible under
 *    `notification.view`.
 */
@Injectable()
export class NotificationConfigAdminApiService {
  constructor(
    @Inject(NOTIFICATION_CONFIG_ADMIN_PORT) private readonly port: NotificationConfigAdminPort,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
    @Inject(NOTIFICATION_AUDIT_EMITTER) private readonly audit: NotificationAuditEmitter,
  ) {}

  // ---- routes ----

  async setChannelRoute(actor: Actor, body: SetChannelRouteBody): Promise<void> {
    await this.assertTenantWritable(actor, body.tenantId);
    await this.port.setChannelRoute(body);
    await this.emit(actor, 'notification.route_set', 'channel_route', routeId(body.notificationType, body.tenantId), body);
  }

  async deleteChannelRoute(actor: Actor, body: DeleteChannelRouteBody): Promise<void> {
    await this.assertTenantWritable(actor, body.tenantId);
    await this.port.deleteChannelRoute(body);
    await this.emit(actor, 'notification.route_deleted', 'channel_route', routeId(body.notificationType, body.tenantId), undefined, body);
  }

  listChannelRoutes() {
    return this.port.listChannelRoutes();
  }

  // ---- templates ----

  async setTemplate(actor: Actor, body: SetTemplateBody): Promise<void> {
    await this.assertTenantWritable(actor, body.tenantId);
    await this.port.setTemplate(body);
    await this.emit(actor, 'notification.template_set', 'template', templateId(body.channel, body.notificationType, body.tenantId), body);
  }

  async deleteTemplate(actor: Actor, body: DeleteTemplateBody): Promise<void> {
    await this.assertTenantWritable(actor, body.tenantId);
    await this.port.deleteTemplate(body);
    await this.emit(actor, 'notification.template_deleted', 'template', templateId(body.channel, body.notificationType, body.tenantId), undefined, body);
  }

  listTemplates() {
    return this.port.listTemplates();
  }

  // ---- credentials ----

  async setProviderCredential(actor: Actor, body: SetProviderCredentialBody): Promise<void> {
    await this.assertTenantWritable(actor, body.tenantId);
    await this.port.setProviderCredential(body);
    // never audit the credential value
    await this.emit(actor, 'notification.credential_set', 'provider_credential', `${body.channel}:${body.tenantId}`, {
      channel: body.channel,
      tenantId: body.tenantId,
    });
  }

  async deleteProviderCredential(actor: Actor, body: DeleteProviderCredentialBody): Promise<void> {
    await this.assertTenantWritable(actor, body.tenantId);
    await this.port.deleteProviderCredential(body);
    await this.emit(actor, 'notification.credential_deleted', 'provider_credential', `${body.channel}:${body.tenantId}`, undefined, body);
  }

  listProviderCredentials() {
    return this.port.listProviderCredentials();
  }

  // ---- internals ----

  private async assertTenantWritable(actor: Actor, tenantId: string | null): Promise<void> {
    if (await this.options.isPlatformAdmin(actor)) return;
    if (tenantId === null) {
      throw new ForbiddenException('only a platform admin may edit the deployment-default configuration');
    }
    if (tenantId !== actor.tenantId) {
      throw new ForbiddenException("cannot edit another tenant's notification configuration");
    }
  }

  private emit(
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string,
    after?: unknown,
    before?: unknown,
  ): Promise<void> | void {
    return this.audit.record({ action, actorId: actor.id, tenantId: actor.tenantId, entityType, entityId, before, after });
  }
}

function routeId(notificationType: string, tenantId: string | null): string {
  return `${notificationType}:${tenantId ?? '*'}`;
}

function templateId(channel: string, notificationType: string, tenantId: string | null): string {
  return `${channel}:${notificationType}:${tenantId ?? '*'}`;
}
