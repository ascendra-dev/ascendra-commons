import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PaymentGatewayStatus, WebhookEventLog } from '../../payment-gateway-adapter.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { WEBHOOK_APPLICATION_ID, WEBHOOK_SQL_EXECUTOR } from '../tokens';

/**
 * Reference `WebhookEventLog` for Postgres. `claim()` is one
 * `INSERT … ON CONFLICT DO NOTHING RETURNING` against
 * `commons_payment_gateway_webhook_claim`'s composite primary key — atomic,
 * never check-then-act (see the port's own doc comment for the race this
 * replaces). `rows.length`, not `rowCount`, is the "did I win" check — the
 * same reasoning every other Postgres adapter in this library uses.
 *
 * Every outcome — `applied`, `duplicate`, and both rejected-event kinds — is
 * also written to `commons_payment_gateway_webhook_event` (the full
 * observability trail), best-effort and guarded: a failure to log an event
 * never changes what `claim()`/`recordRejectedEvent()` report back to the
 * caller.
 */
@Injectable()
export class PostgresWebhookEventLog implements WebhookEventLog {
  private readonly logger = new Logger(PostgresWebhookEventLog.name);

  constructor(
    @Inject(WEBHOOK_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(WEBHOOK_APPLICATION_ID) private readonly application: string,
  ) {}

  async claim(
    gateway: string,
    gatewayReference: string,
    status: PaymentGatewayStatus,
    correlationId?: string,
  ): Promise<'applied' | 'duplicate'> {
    const won = await this.db.execute(sql`
      insert into commons_payment_gateway_webhook_claim (application, gateway, gateway_reference, status)
      values (${this.application}, ${gateway}, ${gatewayReference}, ${status})
      on conflict (application, gateway, gateway_reference, status) do nothing
      returning gateway_reference
    `);
    const outcome = won.rows.length === 1 ? 'applied' : 'duplicate';

    await this.recordEvent({ gateway, gatewayReference, status, outcome, correlationId });
    return outcome;
  }

  async recordRejectedEvent(rejected: {
    gateway: string;
    gatewayReference: string | null;
    status: PaymentGatewayStatus | null;
    outcome: 'ignored_backwards' | 'signature_invalid';
    correlationId?: string;
  }): Promise<void> {
    await this.recordEvent(rejected);
  }

  /** Never throws — an observability-log failure must never surface past claim()/recordRejectedEvent()'s own contract. */
  private async recordEvent(event: {
    gateway: string;
    gatewayReference: string | null;
    status: PaymentGatewayStatus | null;
    outcome: 'applied' | 'duplicate' | 'ignored_backwards' | 'signature_invalid';
    correlationId?: string;
  }): Promise<void> {
    try {
      await this.db.execute(sql`
        insert into commons_payment_gateway_webhook_event (application, gateway, gateway_reference, status, outcome, occurred_at, correlation_id)
        values (
          ${this.application}, ${event.gateway}, ${event.gatewayReference}, ${event.status},
          ${event.outcome}, ${new Date()}, ${event.correlationId ?? null}
        )
      `);
    } catch (err) {
      this.logger.error(
        `Failed to record a webhook event (gateway "${event.gateway}", outcome "${event.outcome}")`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
