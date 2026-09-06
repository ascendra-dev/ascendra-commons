import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationChannel } from '../../notification.types';
import type { SqlExecutor } from './sql-executor';
import { textArray } from './sql-helpers';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from './admin-tokens';
import type { ChannelRouteView, ProviderCredentialView, TemplateView } from './notification-admin.types';

/**
 * CRUD on the three `commons_notification_*` config tables for a notification
 * admin screen. Every write is one upsert or delete, `application`-stamped, on
 * the table's own unique key (`tenant_id` NULL = the deployment default).
 * Requires PostgreSQL 15+ (`NULLS NOT DISTINCT` on the route/template keys).
 *
 * Provider-credential *values* are never returned by the list methods — they
 * typically hold secrets. Audit is the consumer's to wire.
 */
@Injectable()
export class PostgresNotificationConfigAdminService {
  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  // ---- channel routes ----

  async setChannelRoute(input: {
    notificationType: string;
    tenantId: string | null;
    channels: NotificationChannel[];
  }): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_channel_route (application, notification_type, tenant_id, channels)
      values (${this.application}, ${input.notificationType}, ${input.tenantId}, ${textArray(input.channels)})
      on conflict on constraint commons_notification_channel_route_uq
      do update set channels = excluded.channels
    `);
  }

  async deleteChannelRoute(input: { notificationType: string; tenantId: string | null }): Promise<void> {
    await this.db.execute(sql`
      delete from commons_notification_channel_route
      where application = ${this.application} and notification_type = ${input.notificationType}
        and ${tenantCond(input.tenantId)}
    `);
  }

  async listChannelRoutes(): Promise<ChannelRouteView[]> {
    const { rows } = await this.db.execute<{ notification_type: string; tenant_id: string | null; channels: string[] }>(sql`
      select notification_type, tenant_id, channels from commons_notification_channel_route
      where application = ${this.application}
      order by notification_type, tenant_id nulls first
    `);
    return rows.map((r) => ({
      notificationType: r.notification_type,
      tenantId: r.tenant_id,
      channels: r.channels as NotificationChannel[],
    }));
  }

  // ---- templates ----

  async setTemplate(input: {
    channel: NotificationChannel;
    notificationType: string;
    tenantId: string | null;
    subject?: string | null;
    body: string;
    isHtml?: boolean;
  }): Promise<void> {
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
  }

  async deleteTemplate(input: {
    channel: NotificationChannel;
    notificationType: string;
    tenantId: string | null;
  }): Promise<void> {
    await this.db.execute(sql`
      delete from commons_notification_template
      where application = ${this.application} and channel = ${input.channel}
        and notification_type = ${input.notificationType} and ${tenantCond(input.tenantId)}
    `);
  }

  async listTemplates(): Promise<TemplateView[]> {
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
      where application = ${this.application}
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

  // ---- provider credentials ----

  /** `tenantId` is required — credentials are always per-tenant. `config` is stored verbatim. */
  async setProviderCredential(input: {
    channel: NotificationChannel;
    tenantId: string;
    config: Record<string, unknown>;
  }): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_provider_credential (application, channel, tenant_id, config)
      values (${this.application}, ${input.channel}, ${input.tenantId}, ${JSON.stringify(input.config)}::jsonb)
      on conflict (application, channel, tenant_id)
      do update set config = excluded.config
    `);
  }

  async deleteProviderCredential(input: { channel: NotificationChannel; tenantId: string }): Promise<void> {
    await this.db.execute(sql`
      delete from commons_notification_provider_credential
      where application = ${this.application} and channel = ${input.channel} and tenant_id = ${input.tenantId}
    `);
  }

  /** Which (channel, tenant) pairs have a credential — never the credential itself. */
  async listProviderCredentials(): Promise<ProviderCredentialView[]> {
    const { rows } = await this.db.execute<{ channel: string; tenant_id: string }>(sql`
      select channel, tenant_id from commons_notification_provider_credential
      where application = ${this.application}
      order by channel, tenant_id
    `);
    return rows.map((r) => ({ channel: r.channel as NotificationChannel, tenantId: r.tenant_id }));
  }
}

function tenantCond(tenantId: string | null) {
  return tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${tenantId}`;
}
