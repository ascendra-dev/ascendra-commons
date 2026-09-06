import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationConfig, ProviderConfig } from '../../notification-config';
import type { NotificationChannel } from '../../notification.types';
import type { NotificationTemplate } from '../../notification-template';
import { ConfigCache } from './config-cache';
import type { SqlExecutor } from './sql-executor';
import { NOTIFICATION_CONFIG_OPTIONS, NOTIFICATION_CONFIG_SQL_EXECUTOR } from './tokens';

export interface NotificationConfigOptions {
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
 * All three reads go through a short per-process TTL cache (`ConfigCache`) —
 * notification config changes rarely and a burst of sends would otherwise
 * repeat identical queries.
 *
 * Corresponding tables: `schema.ts` / `notification-config.migration.sql`.
 */
@Injectable()
export class PostgresNotificationConfig implements NotificationConfig {
  private readonly cache: ConfigCache;

  constructor(
    @Inject(NOTIFICATION_CONFIG_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_CONFIG_OPTIONS) options: NotificationConfigOptions,
  ) {
    this.cache = new ConfigCache(options.cacheTtlSeconds * 1000);
  }

  channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]> {
    return this.cache.get(`route:${notificationType}:${tenantId ?? ''}`, async () => {
      const { rows } = await this.db.execute<{ channels: string[] }>(sql`
        SELECT channels FROM notification_channel_route
        WHERE notification_type = ${notificationType} AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
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
        SELECT subject, body, is_html FROM notification_template
        WHERE channel = ${channel} AND notification_type = ${notificationType}
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
      const { rows } = await this.db.execute<{ api_key: string; from: string; from_name: string | null }>(sql`
        SELECT api_key, "from", from_name FROM notification_provider_credential
        WHERE channel = ${channel} AND tenant_id = ${tenantId}
      `);
      const row = rows[0];
      if (!row) return null;
      return { apiKey: row.api_key, from: row.from, fromName: row.from_name ?? undefined };
    });
  }
}
