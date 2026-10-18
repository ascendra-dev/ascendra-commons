import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { EventDeliveryAttempt, EventDeliveryRecorder } from '../../domain-events.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { EVENT_DELIVERY_APPLICATION_ID, EVENT_DELIVERY_SQL_EXECUTOR } from '../tokens';

/**
 * Reference `EventDeliveryRecorder` for Postgres — one `INSERT` per
 * `emit()`/`emitCritical()` call. Honors the best-effort contract itself: a
 * write failure is logged and swallowed, never propagated
 * (`InProcessDomainEventEmitter` also guards the call).
 *
 * Corresponding table: `../persistence/domain-event-delivery.schema.ts` (DDL: `../migrations/`).
 */
@Injectable()
export class PostgresEventDeliveryRecorder implements EventDeliveryRecorder {
  private readonly logger = new Logger(PostgresEventDeliveryRecorder.name);

  constructor(
    @Inject(EVENT_DELIVERY_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(EVENT_DELIVERY_APPLICATION_ID) private readonly application: string,
  ) {}

  async recordDelivery(attempt: EventDeliveryAttempt): Promise<void> {
    try {
      const deliveredAt = new Date();
      await this.db.execute(sql`
        insert into commons_domain_events_delivery
          (application, event_name, method, transport, occurred_at, delivered_at, listener_count, status, reason, correlation_id)
        values (
          ${this.application}, ${attempt.eventName}, ${attempt.method}, ${attempt.transport},
          ${attempt.occurredAt}, ${deliveredAt}, ${attempt.listenerCount}, ${attempt.status},
          ${attempt.reason ?? null}, ${attempt.correlationId ?? null}
        )
      `);
    } catch (err) {
      this.logger.error(
        `Failed to record a delivery row for "${attempt.eventName}" — the emitter's own outcome is unaffected`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
