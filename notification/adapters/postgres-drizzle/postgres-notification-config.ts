import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationConfig, ProviderConfig } from '../../notification-config';
import type { NotificationChannel } from '../../notification.types';
import type { NotificationTemplate } from '../../notification-template';
import { ConfigCache } from './config-cache';
import type { SqlExecutor } from './sql-executor';
import { NOTIFICATION_CONFIG_OPTIONS, NOTIFICATION_CONFIG_SQL_EXECUTOR } from './tokens';

export interface NotificationConfigOptions {
  /** Which Ascendra app this process is — written on every row, filtered on every read. */
  application: string;
  /** Config-cache TTL. `0` disables the cache. */
  cacheTtlSeconds: number;
}

/**
 * The database-backed `NotificationConfig` (Model 2) for Postgres/Drizzle.
 *
 * `channelsFor` / `templateFor` resolve a **tenant-specific row first**,
 * falling through to the deployment default (`tenant_id IS NULL`) — so
 * `StaticNotificationConfig` and this answer identically for a tenant with no
 * override row. `providerConfigFor` does **not** fall through: a missing row is
 * a `no_provider_config` failure, never another tenant's account.
 *
 * Every read is scoped by `application`, so the tables stay correct whether
 * each app keeps its own database (one constant value) or they are ever
 * consolidated into one shared config database.
 *
 * All three reads go through a short per-process TTL cache (`ConfigCache`).
 *
 * Corresponding tables: `schema.ts` / `notification-config.migration.sql`.
 */
@Injectable()
export class PostgresNotificationConfig implements NotificationConfig {
  private readonly cache: ConfigCache;
  private readonly application: string;

  constructor(
    @Inject(NOTIFICATION_CONFIG_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_CONFIG_OPTIONS) options: NotificationConfigOptions,
  ) {
    this.application = options.application;
    this.cache = new ConfigCache(options.cacheTtlSeconds * 1000);
  }

  channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]> {
    return this.cache.get(`route:${notificationType}:${tenantId ?? ''}`, async () => {
      const { rows } = await this.db.execute<{ channels: string[] }>(sql`
        SELECT channels FROM commons_notification_channel_route
        WHERE application = ${this.application} AND notification_type = ${notificationType}
          AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
        ORDER BY tenant_id IS NULL
        LIMIT 1
      `);
      return (rows[0]?.channels ?? []) as NotificationChannel[];
    });
  }

  templateFor(
    channel: NotificationChannel,
    notificationType: string,
    tenantId: string | null,
  ): Promise<NotificationTemplate | null> {
    return this.cache.get(`tpl:${channel}:${notificationType}:${tenantId ?? ''}`, async () => {
      const { rows } = await this.db.execute<{ subject: string | null; body: string; is_html: boolean }>(sql`
        SELECT subject, body, is_html FROM commons_notification_template
        WHERE application = ${this.application} AND channel = ${channel} AND notification_type = ${notificationType}
          AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
        ORDER BY tenant_id IS NULL
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return null;
      return { subject: row.subject ?? undefined, body: row.body, isHtml: row.is_html };
    });
  }

  providerConfigFor(channel: NotificationChannel, tenantId: string | null): Promise<ProviderConfig | null> {
    if (tenantId === null) return Promise.resolve(null);
    return this.cache.get(`cred:${channel}:${tenantId}`, async () => {
      const { rows } = await this.db.execute<{ config: Record<string, unknown> }>(sql`
        SELECT config FROM commons_notification_provider_credential
        WHERE application = ${this.application} AND channel = ${channel} AND tenant_id = ${tenantId}
      `);
      return rows[0]?.config ?? null; // returned verbatim — opaque to this library
    });
  }
}
