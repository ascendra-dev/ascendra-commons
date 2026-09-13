import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type DeliveryPage,
  type DeliveryQuery,
  type DeliveryStats,
  type EventDeliveryCatalogEntry,
  type EventDeliveryObservabilityPort,
  type EventDeliveryRecord,
} from '../../domain-events.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { EVENT_DELIVERY_APPLICATION_ID, EVENT_DELIVERY_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reference `EventDeliveryObservabilityPort` for Postgres — one library-owned
 * `SELECT` with a dynamic `WHERE`, keyset-paginated newest-first, plus one
 * aggregate query for `deliveryCatalog()`. Read-only: no `INSERT`/`UPDATE`/`DELETE`
 * path exists here, so "deliveries are write-once" holds exactly as
 * `PostgresEventDeliveryRecorder` intends.
 *
 * Scoped to one `application` — an app's own event-delivery screen. Corresponding
 * table: `../persistence/domain-event-delivery.schema.ts` / `.migration.sql`.
 */
@Injectable()
export class PostgresEventDeliveryObservabilityService implements EventDeliveryObservabilityPort {
  constructor(
    @Inject(EVENT_DELIVERY_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(EVENT_DELIVERY_APPLICATION_ID) private readonly application: string,
  ) {}

  async listDeliveries(query: DeliveryQuery = {}): Promise<DeliveryPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const order = query.order ?? 'desc';
    const orderSql = order === 'asc' ? sql`asc` : sql`desc`;

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.eventName !== undefined) conds.push(sql`event_name = ${query.eventName}`);
    if (query.method !== undefined) conds.push(sql`method = ${query.method}`);
    if (query.status !== undefined) conds.push(sql`status = ${query.status}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`delivered_at >= ${query.since}`);
    if (query.until) conds.push(sql`delivered_at < ${query.until}`);

    const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cursor) {
      conds.push(
        order === 'asc'
          ? sql`(delivered_at > ${cursor.timestamp} or (delivered_at = ${cursor.timestamp} and id > ${cursor.id}))`
          : sql`(delivered_at < ${cursor.timestamp} or (delivered_at = ${cursor.timestamp} and id < ${cursor.id}))`,
      );
    }

    const rows = (
      await this.db.execute(sql`
        select id, event_name, method, transport, occurred_at, delivered_at, listener_count, status, reason, correlation_id
        from commons_domain_events_delivery
        where ${sql.join(conds, sql` and `)}
        order by delivered_at ${orderSql}, id ${orderSql}
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const deliveries = rows.slice(0, limit);
      const last = deliveries[deliveries.length - 1];
      return { deliveries, nextCursor: encodeKeysetCursor(last.deliveredAt, last.id) };
    }
    return { deliveries: rows };
  }

  async deliveryCatalog(): Promise<EventDeliveryCatalogEntry[]> {
    const { rows } = await this.db.execute(sql`
      select
        event_name,
        count(*) as total_deliveries,
        count(*) filter (where status = 'no_listeners') as no_listener_count,
        count(*) filter (where status = 'dispatch_failed') as dispatch_failed_count,
        max(delivered_at) as last_delivered_at
      from commons_domain_events_delivery
      where application = ${this.application}
      group by event_name
      order by event_name
    `);

    return rows.map((row) => ({
      eventName: String(row.event_name),
      totalDeliveries: Number(row.total_deliveries),
      noListenerCount: Number(row.no_listener_count),
      dispatchFailedCount: Number(row.dispatch_failed_count),
      lastDeliveredAt: row.last_delivered_at instanceof Date ? row.last_delivered_at : new Date(String(row.last_delivered_at)),
    }));
  }

  async deliveryStats(since: Date): Promise<DeliveryStats> {
    const { rows: dayRows } = await this.db.execute(sql`
      select
        to_char(date_trunc('day', delivered_at), 'YYYY-MM-DD') as day,
        count(*) as total,
        count(*) filter (where status = 'no_listeners') as no_listener_count,
        count(*) filter (where status = 'dispatch_failed') as dispatch_failed_count
      from commons_domain_events_delivery
      where application = ${this.application} and delivered_at >= ${since}
      group by date_trunc('day', delivered_at)
      order by date_trunc('day', delivered_at) asc
    `);

    const { rows: topRows } = await this.db.execute(sql`
      select event_name, count(*) as total_deliveries
      from commons_domain_events_delivery
      where application = ${this.application} and delivered_at >= ${since}
      group by event_name
      order by total_deliveries desc
      limit 10
    `);

    const perDay = dayRows.map((row) => ({
      date: String(row.day),
      total: Number(row.total),
      noListenerCount: Number(row.no_listener_count),
      dispatchFailedCount: Number(row.dispatch_failed_count),
    }));

    const totalDeliveries = perDay.reduce((sum, day) => sum + day.total, 0);
    const totalNoListener = perDay.reduce((sum, day) => sum + day.noListenerCount, 0);
    const totalDispatchFailed = perDay.reduce((sum, day) => sum + day.dispatchFailedCount, 0);

    return {
      perDay,
      topEvents: topRows.map((row) => ({
        eventName: String(row.event_name),
        totalDeliveries: Number(row.total_deliveries),
      })),
      noListenerRate: totalDeliveries === 0 ? 0 : totalNoListener / totalDeliveries,
      dispatchFailedRate: totalDeliveries === 0 ? 0 : totalDispatchFailed / totalDeliveries,
    };
  }
}

function mapRow(row: Record<string, unknown>): EventDeliveryRecord {
  return {
    id: String(row.id),
    eventName: String(row.event_name),
    method: row.method as EventDeliveryRecord['method'],
    transport: String(row.transport),
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at)),
    deliveredAt: row.delivered_at instanceof Date ? row.delivered_at : new Date(String(row.delivered_at)),
    listenerCount: Number(row.listener_count),
    status: row.status as EventDeliveryRecord['status'],
    reason: row.reason == null ? null : String(row.reason),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}
