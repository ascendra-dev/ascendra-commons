import { sql } from 'drizzle-orm';
import type { NotificationConfigData } from '../../notification-config';
import { textArray } from './sql-helpers';
import type { SqlExecutor } from './sql-executor';

/**
 * Write a Model 1 `NotificationConfigData` into the `notification_*` tables as
 * **deployment-default rows** (`tenant_id NULL`) for `application`, so
 * switching a project from `model: 'static'` to `model: 'database'` is
 * behaviour-preserving.
 *
 * `application` must be the same value passed to
 * `PostgresNotificationConfigModule.forRoot({ application })`.
 *
 * Per-tenant override rows (a tenant's own routing/templates, a tenant's
 * credentials) are added afterwards through the consuming project's own admin
 * path — not here.
 *
 * Idempotent — upserts. Run at deploy time or in a migration.
 */
export async function seedNotificationConfigFromData(
  db: SqlExecutor,
  application: string,
  data: NotificationConfigData,
): Promise<void> {
  for (const [notificationType, channels] of Object.entries(data.channels)) {
    await db.execute(sql`
      INSERT INTO notification_channel_route (application, notification_type, tenant_id, channels)
      VALUES (${application}, ${notificationType}, NULL, ${textArray(channels)})
      ON CONFLICT (application, notification_type, tenant_id)
        DO UPDATE SET channels = EXCLUDED.channels
    `);
  }

  for (const [channel, byType] of Object.entries(data.templates ?? {})) {
    for (const [notificationType, tpl] of Object.entries(byType ?? {})) {
      await db.execute(sql`
        INSERT INTO notification_template (application, channel, notification_type, tenant_id, subject, body, is_html)
        VALUES (${application}, ${channel}, ${notificationType}, NULL, ${tpl.subject ?? null}, ${tpl.body}, ${tpl.isHtml ?? false})
        ON CONFLICT (application, channel, notification_type, tenant_id)
          DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, is_html = EXCLUDED.is_html
      `);
    }
  }

  for (const [channel, byTenant] of Object.entries(data.providerConfigs ?? {})) {
    for (const [tenantId, cfg] of Object.entries(byTenant ?? {})) {
      await db.execute(sql`
        INSERT INTO notification_provider_credential (application, channel, tenant_id, config)
        VALUES (${application}, ${channel}, ${tenantId}, ${JSON.stringify(cfg)}::jsonb)
        ON CONFLICT (application, channel, tenant_id)
          DO UPDATE SET config = EXCLUDED.config
      `);
    }
  }
}
