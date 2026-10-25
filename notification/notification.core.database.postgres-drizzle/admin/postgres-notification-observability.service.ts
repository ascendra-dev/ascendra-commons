import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { DeliveryContent, NotificationChannel } from '../../notification.core';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidDeliveryCursorError,
  isDeliveryId,
  type ConfigScope,
  type CoverageGap,
  type DeliveryContentRecord,
  type DeliveryHistoryPage,
  type DeliveryHistoryQuery,
  type DeliveryRecord,
  type DeliveryStats,
  type DeliveryStatsQuery,
  type NotificationObservabilityPort,
} from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** `attempted_at` at the column's own precision (microseconds), for the keyset cursor — a JS `Date` keeps milliseconds. */
const ATTEMPTED_AT_KEY = sql`to_char(attempted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as attempted_at_key`;

/**
 * `NotificationObservabilityPort` for Postgres/Drizzle — the delivery log
 * (`getDeliveryHistory` / `getDeliveryContent`) and gaps in the
 * routing/template/credential config (`configCoverageGaps`). Everything
 * `application`-scoped. No write path.
 */
@Injectable()
export class PostgresNotificationObservabilityService implements NotificationObservabilityPort {
  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  async getDeliveryHistory(query: DeliveryHistoryQuery = {}): Promise<DeliveryHistoryPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.notificationType !== undefined) conds.push(sql`notification_type = ${query.notificationType}`);
    if (query.channel !== undefined) conds.push(sql`channel = ${query.channel}`);
    if (query.tenantId !== undefined) conds.push(sql`tenant_id = ${query.tenantId}`);
    if (query.recipientRef !== undefined) conds.push(sql`recipient_ref = ${query.recipientRef}`);
    if (query.status !== undefined) conds.push(sql`status = ${query.status}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.test !== undefined) conds.push(sql`is_test = ${query.test}`);
    if (query.since) conds.push(sql`attempted_at >= ${query.since}`);
    if (query.until) conds.push(sql`attempted_at < ${query.until}`);

    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      // A cursor that doesn't decode was never issued here — silently starting from the top would repeat page one.
      if (!cursor) throw new InvalidDeliveryCursorError(`Unrecognized cursor "${query.cursor}"`);
      const ts = sql`${cursor.timestamp}::timestamptz`;
      // Leads with the indexed column, so the index range starts at the cursor — the OR alone is a Filter, scanned
      // from the top on every page.
      conds.push(sql`attempted_at <= ${ts} and (attempted_at < ${ts} or id < ${cursor.id}::bigint)`);
    }

    const rows = (
      await this.db.execute<DeliveryRow & { attempted_at_key: string }>(sql`
        select id, notification_type, channel, tenant_id, recipient_ref, status, reason,
               provider_message_id, attempted_at, updated_at, correlation_id,
               (content is not null) as has_content, is_test, ${ATTEMPTED_AT_KEY}
        from commons_notification_delivery
        where ${sql.join(conds, sql` and `)}
        order by attempted_at desc, id desc
        limit ${limit + 1}
      `)
    ).rows;

    if (rows.length > limit) {
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { deliveries: page.map(mapRow), nextCursor: encodeKeysetCursor(String(last.attempted_at_key), String(last.id)) };
    }
    return { deliveries: rows.map(mapRow) };
  }

  async getDelivery(id: string): Promise<DeliveryRecord | null> {
    // Not a delivery id can't name a row — and `::bigint` would fail the query.
    if (!isDeliveryId(id)) return null;
    const { rows } = await this.db.execute<DeliveryRow>(sql`
      select id, notification_type, channel, tenant_id, recipient_ref, status, reason,
             provider_message_id, attempted_at, updated_at, correlation_id,
             (content is not null) as has_content, is_test
      from commons_notification_delivery
      where application = ${this.application} and id = ${id}::bigint
    `);
    const row = rows[0];
    return row ? mapRow(row) : null;
  }

  async getDeliveryContent(id: string): Promise<DeliveryContentRecord | null> {
    if (!isDeliveryId(id)) return null;
    const { rows } = await this.db.execute<{
      id: string | number;
      notification_type: string;
      channel: string;
      recipient_ref: string;
      attempted_at: string | Date;
      content: DeliveryContent | null;
    }>(sql`
      select id, notification_type, channel, recipient_ref, attempted_at, content
      from commons_notification_delivery
      where application = ${this.application} and id = ${id}::bigint
    `);
    const row = rows[0];
    if (!row || row.content == null) return null;
    return {
      id: String(row.id),
      notificationType: row.notification_type,
      channel: row.channel as NotificationChannel,
      recipientRef: row.recipient_ref,
      attemptedAt: asDate(row.attempted_at),
      content: row.content,
    };
  }

  async configCoverageGaps(scope?: ConfigScope): Promise<CoverageGap[]> {
    // Scoped: the defaults plus one tenant's rows — a tenant admin's gaps, never another tenant's config.
    const rowsIn = scope ? sql`(tenant_id is null or tenant_id = ${scope.tenantId})` : sql`true`;
    const [routes, templates, creds] = await Promise.all([
      this.db.execute<{ notification_type: string; tenant_id: string | null; channels: string[] }>(
        sql`select notification_type, tenant_id, channels from commons_notification_channel_route where application = ${this.application} and ${rowsIn}`,
      ),
      this.db.execute<{ channel: string; notification_type: string; tenant_id: string | null }>(
        sql`select distinct channel, notification_type, tenant_id from commons_notification_template where application = ${this.application} and ${rowsIn}`,
      ),
      this.db.execute<{ channel: string; tenant_id: string }>(
        sql`select distinct channel, tenant_id from commons_notification_provider_credential where application = ${this.application} and ${rowsIn}`,
      ),
    ]);

    const templateKey = (c: string, nt: string, t: string | null) => `${c}|${nt}|${t ?? ''}`;
    const templateSet = new Set(templates.rows.map((r) => templateKey(r.channel, r.notification_type, r.tenant_id)));
    const hasTemplate = (channel: string, nt: string, tenantId: string | null) =>
      templateSet.has(templateKey(channel, nt, tenantId)) || templateSet.has(templateKey(channel, nt, null));

    const credSet = new Set(creds.rows.map((r) => `${r.channel}|${r.tenant_id}`));

    const gaps: CoverageGap[] = [];
    for (const route of routes.rows) {
      for (const channel of route.channels) {
        if (!hasTemplate(channel, route.notification_type, route.tenant_id)) {
          gaps.push({
            notificationType: route.notification_type,
            tenantId: route.tenant_id,
            channel: channel as NotificationChannel,
            kind: 'missing_template',
          });
        }
        if (route.tenant_id !== null && !credSet.has(`${channel}|${route.tenant_id}`)) {
          gaps.push({
            notificationType: route.notification_type,
            tenantId: route.tenant_id,
            channel: channel as NotificationChannel,
            kind: 'missing_provider_credential',
          });
        }
      }
    }
    return gaps;
  }

  async getDeliveryStats(query: DeliveryStatsQuery = {}): Promise<DeliveryStats> {
    const until = query.until ?? new Date();
    const since = query.since ?? new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);

    const conds: SQL[] = [
      sql`application = ${this.application}`,
      sql`attempted_at >= ${since}`,
      sql`attempted_at < ${until}`,
      // A test send checks the config — it isn't deliverability.
      sql`not is_test`,
    ];
    if (query.tenantId !== undefined) conds.push(sql`tenant_id = ${query.tenantId}`);
    const where = sql.join(conds, sql` and `);

    const [byChannel, byType, byDay] = await Promise.all([
      this.db.execute<{ channel: string; status: string; count: number }>(sql`
        select channel, status, count(*)::int as count
        from commons_notification_delivery
        where ${where}
        group by channel, status
      `),
      this.db.execute<{ notification_type: string; status: string; count: number }>(sql`
        select notification_type, status, count(*)::int as count
        from commons_notification_delivery
        where ${where}
        group by notification_type, status
      `),
      this.db.execute<{ day: string | Date; count: number }>(sql`
        select date_trunc('day', attempted_at) as day, count(*)::int as count
        from commons_notification_delivery
        where ${where}
        group by day
        order by day
      `),
    ]);

    return {
      since,
      until,
      byChannel: byChannel.rows.map((r) => ({
        channel: r.channel as NotificationChannel,
        status: r.status as DeliveryRecord['status'],
        count: Number(r.count),
      })),
      byType: byType.rows.map((r) => ({
        notificationType: r.notification_type,
        status: r.status as DeliveryRecord['status'],
        count: Number(r.count),
      })),
      byDay: byDay.rows.map((r) => ({ day: asDate(r.day).toISOString().slice(0, 10), count: Number(r.count) })),
    };
  }
}

interface DeliveryRow {
  id: string | number;
  notification_type: string;
  channel: string;
  tenant_id: string | null;
  recipient_ref: string;
  status: string;
  reason: string | null;
  provider_message_id: string | null;
  attempted_at: string | Date;
  updated_at: string | Date;
  correlation_id: string | null;
  has_content: boolean;
  is_test: boolean;
}

function mapRow(row: DeliveryRow): DeliveryRecord {
  return {
    id: String(row.id),
    notificationType: row.notification_type,
    channel: row.channel as NotificationChannel,
    tenantId: row.tenant_id,
    recipientRef: row.recipient_ref,
    status: row.status as DeliveryRecord['status'],
    reason: row.reason,
    providerMessageId: row.provider_message_id,
    attemptedAt: asDate(row.attempted_at),
    updatedAt: asDate(row.updated_at),
    correlationId: row.correlation_id,
    hasContent: row.has_content === true,
    isTest: row.is_test === true,
  };
}

function asDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}
