import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationChannel } from '../../notification.core';
import { ConfigCache } from '../../notification.core.database';
import type {
  ChannelRouteView,
  ConfigScope,
  DeleteChannelRouteInput,
  DeleteProviderCredentialInput,
  DeleteTemplateInput,
  NotificationConfigAdminPort,
  ProviderCredentialView,
  SetChannelRouteInput,
  SetProviderCredentialInput,
  SetTemplateInput,
  TemplateView,
} from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';
import { textArray } from '../persistence/sql-helpers';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from '../tokens';

/**
 * `NotificationConfigAdminPort` for Postgres/Drizzle — CRUD on the three
 * `commons_notification_*` config tables. Every write is one upsert or delete,
 * `application`-stamped, on the table's own unique key (`tenant_id` NULL = the
 * deployment default). Requires PostgreSQL 15+ (`NULLS NOT DISTINCT`).
 *
 * Every write empties the process's config caches (`ConfigCache.invalidateAll`), so the next send uses it.
 *
 * Provider-credential *values* are never returned by `listProviderCredentials`.
 * Audit + actor-scoping are `notification.api`'s.
 */
@Injectable()
export class PostgresNotificationConfigAdminService implements NotificationConfigAdminPort {
  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  async getChannelRoute(notificationType: string, tenantId: string | null): Promise<ChannelRouteView | null> {
    const { rows } = await this.db.execute<{ notification_type: string; tenant_id: string | null; channels: string[] }>(sql`
      select notification_type, tenant_id, channels from commons_notification_channel_route
      where application = ${this.application} and notification_type = ${notificationType} and ${tenantCond(tenantId)}
    `);
    const r = rows[0];
    return r ? { notificationType: r.notification_type, tenantId: r.tenant_id, channels: r.channels as NotificationChannel[] } : null;
  }

  async setChannelRoute(input: SetChannelRouteInput): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_channel_route (application, notification_type, tenant_id, channels)
      values (${this.application}, ${input.notificationType}, ${input.tenantId}, ${textArray(input.channels)})
      on conflict on constraint commons_notification_channel_route_uq
      do update set channels = excluded.channels
    `);
    ConfigCache.invalidateAll();
  }

  async deleteChannelRoute(input: DeleteChannelRouteInput): Promise<void> {
    await this.db.execute(sql`
      delete from commons_notification_channel_route
      where application = ${this.application} and notification_type = ${input.notificationType}
        and ${tenantCond(input.tenantId)}
    `);
    ConfigCache.invalidateAll();
  }

  async listChannelRoutes(scope?: ConfigScope): Promise<ChannelRouteView[]> {
    const { rows } = await this.db.execute<{ notification_type: string; tenant_id: string | null; channels: string[] }>(sql`
      select notification_type, tenant_id, channels from commons_notification_channel_route
      where application = ${this.application} and ${defaultsAnd(scope)}
      order by notification_type, tenant_id nulls first
    `);
    return rows.map((r) => ({
      notificationType: r.notification_type,
      tenantId: r.tenant_id,
      channels: r.channels as NotificationChannel[],
    }));
  }

  async getTemplate(channel: NotificationChannel, notificationType: string, tenantId: string | null): Promise<TemplateView | null> {
    const { rows } = await this.db.execute<{
      channel: string;
      notification_type: string;
      tenant_id: string | null;
      subject: string | null;
      body: string;
      is_html: boolean;
    }>(sql`
      select channel, notification_type, tenant_id, subject, body, is_html from commons_notification_template
      where application = ${this.application} and channel = ${channel} and notification_type = ${notificationType}
        and ${tenantCond(tenantId)}
    `);
    const r = rows[0];
    return r
      ? { channel: r.channel as NotificationChannel, notificationType: r.notification_type, tenantId: r.tenant_id, subject: r.subject, body: r.body, isHtml: r.is_html }
      : null;
  }

  async setTemplate(input: SetTemplateInput): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_template
        (application, channel, notification_type, tenant_id, subject, body, is_html)
      values (
        ${this.application}, ${input.channel}, ${input.notificationType}, ${input.tenantId},
        ${input.subject ?? null}, ${input.body}, ${input.isHtml ?? false}
      )
      on conflict on constraint commons_notification_template_uq
      do update set subject = excluded.subject, body = excluded.body, is_html = excluded.is_html
    `);
    ConfigCache.invalidateAll();
  }

  async deleteTemplate(input: DeleteTemplateInput): Promise<void> {
    await this.db.execute(sql`
      delete from commons_notification_template
      where application = ${this.application} and channel = ${input.channel}
        and notification_type = ${input.notificationType} and ${tenantCond(input.tenantId)}
    `);
    ConfigCache.invalidateAll();
  }

  async listTemplates(scope?: ConfigScope): Promise<TemplateView[]> {
    const { rows } = await this.db.execute<{
      channel: string;
      notification_type: string;
      tenant_id: string | null;
      subject: string | null;
      body: string;
      is_html: boolean;
    }>(sql`
      select channel, notification_type, tenant_id, subject, body, is_html
      from commons_notification_template
      where application = ${this.application} and ${defaultsAnd(scope)}
      order by notification_type, channel, tenant_id nulls first
    `);
    return rows.map((r) => ({
      channel: r.channel as NotificationChannel,
      notificationType: r.notification_type,
      tenantId: r.tenant_id,
      subject: r.subject,
      body: r.body,
      isHtml: r.is_html,
    }));
  }

  async hasProviderCredential(channel: NotificationChannel, tenantId: string | null): Promise<boolean> {
    // The value stays in the table — only whether a row exists.
    const { rows } = await this.db.execute(sql`
      select 1 from commons_notification_provider_credential
      where application = ${this.application} and channel = ${channel} and ${tenantCond(tenantId)}
    `);
    return rows.length > 0;
  }

  async setProviderCredential(input: SetProviderCredentialInput): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_provider_credential (application, channel, tenant_id, config)
      values (${this.application}, ${input.channel}, ${input.tenantId}, ${JSON.stringify(input.config)}::jsonb)
      on conflict on constraint commons_notification_provider_credential_uq
      do update set config = excluded.config
    `);
    ConfigCache.invalidateAll();
  }

  async deleteProviderCredential(input: DeleteProviderCredentialInput): Promise<void> {
    await this.db.execute(sql`
      delete from commons_notification_provider_credential
      where application = ${this.application} and channel = ${input.channel} and ${tenantCond(input.tenantId)}
    `);
    ConfigCache.invalidateAll();
  }

  async listProviderCredentials(scope?: ConfigScope): Promise<ProviderCredentialView[]> {
    // A tenant admin sees their own and the platform's — whether there's an account to fall back to.
    const { rows } = await this.db.execute<{ channel: string; tenant_id: string | null }>(sql`
      select channel, tenant_id from commons_notification_provider_credential
      where application = ${this.application} and ${defaultsAnd(scope)}
      order by channel, tenant_id nulls first
    `);
    return rows.map((r) => ({ channel: r.channel as NotificationChannel, tenantId: r.tenant_id }));
  }
}

/** The deployment defaults plus one tenant's rows — or every row when unscoped. */
function defaultsAnd(scope?: ConfigScope) {
  return scope ? sql`(tenant_id is null or tenant_id = ${scope.tenantId})` : sql`true`;
}

function tenantCond(tenantId: string | null) {
  return tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${tenantId}`;
}
