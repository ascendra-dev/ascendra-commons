import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  DeliveryAttempt,
  DeliveryStatusUpdate,
  NotificationDeliveryRecorder,
} from '../../notification-delivery-recorder';
import type { SqlExecutor } from './sql-executor';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from './admin-tokens';

/**
 * Reference `NotificationDeliveryRecorder` for Postgres — one batched `INSERT`
 * per `notify()`, and an `UPDATE` matched on `provider_message_id` for a
 * provider webhook. Honors the best-effort contract itself: a write failure is
 * logged and swallowed, never propagated (`Notifier` also guards the call).
 *
 * Corresponding table: `notification-delivery.schema.ts` /
 * `notification-delivery.migration.sql`.
 */
@Injectable()
export class PostgresNotificationDeliveryRecorder implements NotificationDeliveryRecorder {
  private readonly logger = new Logger(PostgresNotificationDeliveryRecorder.name);

  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  async recordAttempts(attempts: DeliveryAttempt[]): Promise<void> {
    if (attempts.length === 0) return;
    try {
      const rows = sql.join(
        attempts.map(
          (a) => sql`(
            ${this.application}, ${a.notificationType}, ${a.channel}, ${a.tenantId},
            ${a.recipientRef}, ${a.status}, ${a.reason ?? null}, ${a.providerMessageId ?? null},
            ${a.attemptedAt}, ${a.attemptedAt}, ${a.correlationId ?? null}
          )`,
        ),
        sql`, `,
      );
      await this.db.execute(sql`
        insert into commons_notification_delivery
          (application, notification_type, channel, tenant_id, recipient_ref, status, reason,
           provider_message_id, attempted_at, updated_at, correlation_id)
        values ${rows}
      `);
    } catch (err) {
      this.logger.error(
        `Failed to record ${attempts.length} notification delivery row(s) — delivery outcome is unaffected`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async updateDeliveryStatus(update: DeliveryStatusUpdate): Promise<void> {
    try {
      await this.db.execute(sql`
        update commons_notification_delivery
        set status = ${update.status},
            reason = coalesce(${update.detail ?? null}, reason),
            updated_at = now()
        where application = ${this.application} and provider_message_id = ${update.providerMessageId}
      `);
    } catch (err) {
      this.logger.error(
        `Failed to apply delivery-status update for provider message "${update.providerMessageId}"`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
