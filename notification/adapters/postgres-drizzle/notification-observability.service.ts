import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { NotificationChannel } from '../../notification.types';
import type { SqlExecutor } from './sql-executor';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from './admin-tokens';
import type {
  CoverageGap,
  DeliveryHistoryPage,
  DeliveryHistoryQuery,
  DeliveryRecord,
} from './notification-admin.types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Read-only reporting for a notification admin screen: the delivery log
 * (`getDeliveryHistory`) and gaps in the routing/template/credential config
 * (`configCoverageGaps`). Everything `application`-scoped. No write path.
 */
@Injectable()
export class PostgresNotificationObservabilityService {
  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  /** Delivery attempts, newest first, keyset-paginated on `(attempted_at, id)`. */
  async getDeliveryHistory(query: DeliveryHistoryQuery = {}): Promise<DeliveryHistoryPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.notificationType !== undefined) conds.push(sql`notification_type = ${query.notificationType}`);
    if (query.channel !== undefined) conds.push(sql`channel = ${query.channel}`);
    if (query.tenantId !== undefined) conds.push(sql`tenant_id = ${query.tenantId}`);
    if (query.recipientRef !== undefined) conds.push(sql`recipient_ref = ${query.recipientRef}`);
    if (query.status !== undefined) conds.push(sql`status = ${query.status}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`attempted_at >= ${query.since}`);
    if (query.until) conds.push(sql`attempted_at < ${query.until}`);

    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor) {
      conds.push(
        sql`(attempted_at < ${cursor.attemptedAt} or (attempted_at = ${cursor.attemptedAt} and id < ${cursor.id}::bigint))`,
      );
    }

    const rows = (
      await this.db.execute<DeliveryRow>(sql`
        select id, notification_type, channel, tenant_id, recipient_ref, status, reason,
               provider_message_id, attempted_at, updated_at, correlation_id
        from commons_notification_delivery
        where ${sql.join(conds, sql` and `)}
        order by attempted_at desc, id desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const deliveries = rows.slice(0, limit);
      const last = deliveries[deliveries.length - 1];
      return { deliveries, nextCursor: encodeCursor(last.attemptedAt, last.id) };
    }
    return { deliveries: rows };
  }

  /**
   * For every routed (notificationType, tenant, channel): is there a usable
   * template, and (for a tenant-specific route) a provider credential? Uses the
   * same tenant → deployment-default fall-through as `PostgresNotificationConfig`.
   */
  async configCoverageGaps(): Promise<CoverageGap[]> {
    const [routes, templates, creds] = await Promise.all([
      this.db.execute<{ notification_type: string; tenant_id: string | null; channels: string[] }>(
        sql`select notification_type, tenant_id, channels from commons_notification_channel_route where application = ${this.application}`,
      ),
      this.db.execute<{ channel: string; notification_type: string; tenant_id: string | null }>(
        sql`select distinct channel, notification_type, tenant_id from commons_notification_template where application = ${this.application}`,
      ),
      this.db.execute<{ channel: string; tenant_id: string }>(
        sql`select distinct channel, tenant_id from commons_notification_provider_credential where application = ${this.application}`,
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
  };
}

function asDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function encodeCursor(attemptedAt: Date, id: string): string {
  return Buffer.from(`${attemptedAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { attemptedAt: Date; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!ts || !id || Number.isNaN(Date.parse(ts))) return null;
    return { attemptedAt: new Date(ts), id };
  } catch {
    return null;
  }
}
