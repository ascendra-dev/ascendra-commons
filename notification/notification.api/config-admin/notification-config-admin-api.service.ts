import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import { renderTemplate } from '../../notification.core';
import {
  NOTIFICATION_CONFIG_ADMIN_PORT,
  type ConfigScope,
  type NotificationConfigAdminPort,
} from '../../notification.core.database';
import { NOTIFICATION_API_OPTIONS, NOTIFICATION_AUDIT_EMITTER } from '../tokens';
import type { NotificationApiOptions } from '../notification-api.options';
import type { NotificationAuditEmitter } from '../notification-audit.port';
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
 * The actor-scoped rules `@RequiresAction('notification.manage_config')` can't
 * express, plus audit emission:
 *
 *  - A non-platform admin may only touch rows for **their own tenant** — a
 *    `null` tenantId (deployment default) or a different tenant is rejected.
 *  - Each mutation emits a `NotificationAuditEvent` through the optional emitter.
 *  - Reads (`list*`) show a non-platform actor the deployment defaults plus their own tenant's rows — never another
 *    tenant's routing, white-labeled templates or which tenants hold a provider account.
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

  async listChannelRoutes(actor: Actor) {
    return this.port.listChannelRoutes(await this.scopeOf(actor));
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

  async listTemplates(actor: Actor) {
    return this.port.listTemplates(await this.scopeOf(actor));
  }

  /** Renders a candidate template against sample variables — stateless, no port/persistence involved. */
  previewTemplate(body: PreviewTemplateBody) {
    return renderTemplate({ subject: body.subject, body: body.body, isHtml: body.isHtml }, body.variables ?? {});
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

  async listProviderCredentials(actor: Actor) {
    return this.port.listProviderCredentials(await this.scopeOf(actor));
  }

  // ---- internals ----

  /** A platform admin sees every row; anyone else the defaults plus their own tenant (a tenantless one: defaults only). */
  private async scopeOf(actor: Actor): Promise<ConfigScope | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return undefined;
    return { tenantId: actor.tenantId ?? '' };
  }

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
