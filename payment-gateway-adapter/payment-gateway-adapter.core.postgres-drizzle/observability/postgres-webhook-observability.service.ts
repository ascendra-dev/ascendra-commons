import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type WebhookEventPage,
  type WebhookEventQuery,
  type WebhookEventRecord,
  type WebhookObservabilityPort,
  type WebhookOutcomeCount,
} from '../../payment-gateway-adapter.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { WEBHOOK_APPLICATION_ID, WEBHOOK_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reference `WebhookObservabilityPort` for Postgres — one dynamic `SELECT`,
 * keyset-paginated newest-first, plus one aggregate query for
 * `outcomeCounts()`. Read-only. Scoped to one `application`.
 */
@Injectable()
export class PostgresWebhookObservabilityService implements WebhookObservabilityPort {
  constructor(
    @Inject(WEBHOOK_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(WEBHOOK_APPLICATION_ID) private readonly application: string,
  ) {}

  async listEvents(query: WebhookEventQuery = {}): Promise<WebhookEventPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.gateway !== undefined) conds.push(sql`gateway = ${query.gateway}`);
    if (query.outcome !== undefined) conds.push(sql`outcome = ${query.outcome}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`occurred_at >= ${query.since}`);
    if (query.until) conds.push(sql`occurred_at < ${query.until}`);

    const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cursor) {
      conds.push(sql`(occurred_at < ${cursor.timestamp} or (occurred_at = ${cursor.timestamp} and id < ${cursor.id}))`);
    }

    const rows = (
      await this.db.execute(sql`
        select id, gateway, gateway_reference, status, outcome, occurred_at, correlation_id
        from commons_payment_gateway_webhook_event
        where ${sql.join(conds, sql` and `)}
        order by occurred_at desc, id desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const events = rows.slice(0, limit);
      const last = events[events.length - 1];
      return { events, nextCursor: encodeKeysetCursor(last.occurredAt, last.id) };
    }
    return { events: rows };
  }

  async outcomeCounts(since?: Date): Promise<WebhookOutcomeCount[]> {
    const conds: SQL[] = [sql`application = ${this.application}`];
    if (since) conds.push(sql`occurred_at >= ${since}`);

    const { rows } = await this.db.execute(sql`
      select outcome, count(*) as count
      from commons_payment_gateway_webhook_event
      where ${sql.join(conds, sql` and `)}
      group by outcome
      order by outcome
    `);

    return rows.map((row) => ({ outcome: row.outcome as WebhookOutcomeCount['outcome'], count: Number(row.count) }));
  }
}

function mapRow(row: Record<string, unknown>): WebhookEventRecord {
  return {
    id: String(row.id),
    gateway: String(row.gateway),
    gatewayReference: row.gateway_reference == null ? null : String(row.gateway_reference),
    status: row.status == null ? null : (row.status as WebhookEventRecord['status']),
    outcome: row.outcome as WebhookEventRecord['outcome'],
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at)),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}
