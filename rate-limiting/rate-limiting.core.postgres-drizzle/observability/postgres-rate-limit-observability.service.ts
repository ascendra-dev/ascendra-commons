import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type RateLimitObservabilityPort,
  type RateLimitRejectionRecord,
  type RejectionPage,
  type RejectionQuery,
  type RouteRejectionCount,
} from '../../rate-limiting.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { RATE_LIMIT_APPLICATION_ID, RATE_LIMIT_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reference `RateLimitObservabilityPort` for Postgres — one dynamic
 * `SELECT`, keyset-paginated newest-first, plus one aggregate query for
 * `rejectionCatalog()`. Read-only. Scoped to one `application`.
 */
@Injectable()
export class PostgresRateLimitObservabilityService implements RateLimitObservabilityPort {
  constructor(
    @Inject(RATE_LIMIT_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(RATE_LIMIT_APPLICATION_ID) private readonly application: string,
  ) {}

  async listRejections(query: RejectionQuery = {}): Promise<RejectionPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.route !== undefined) conds.push(sql`route = ${query.route}`);
    if (query.identifier !== undefined) conds.push(sql`identifier = ${query.identifier}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`rejected_at >= ${query.since}`);
    if (query.until) conds.push(sql`rejected_at < ${query.until}`);

    const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cursor) {
      conds.push(sql`(rejected_at < ${cursor.timestamp} or (rejected_at = ${cursor.timestamp} and id < ${cursor.id}))`);
    }

    const rows = (
      await this.db.execute(sql`
        select id, route, identifier, "limit", ttl_ms, rejected_at, correlation_id
        from commons_rate_limit_rejection
        where ${sql.join(conds, sql` and `)}
        order by rejected_at desc, id desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const rejections = rows.slice(0, limit);
      const last = rejections[rejections.length - 1];
      return { rejections, nextCursor: encodeKeysetCursor(last.rejectedAt, last.id) };
    }
    return { rejections: rows };
  }

  async rejectionCatalog(since?: Date): Promise<RouteRejectionCount[]> {
    const conds: SQL[] = [sql`application = ${this.application}`];
    if (since) conds.push(sql`rejected_at >= ${since}`);

    const { rows } = await this.db.execute(sql`
      select route, count(*) as count
      from commons_rate_limit_rejection
      where ${sql.join(conds, sql` and `)}
      group by route
      order by count desc
    `);

    return rows.map((row) => ({ route: String(row.route), count: Number(row.count) }));
  }
}

function mapRow(row: Record<string, unknown>): RateLimitRejectionRecord {
  return {
    id: String(row.id),
    route: String(row.route),
    identifier: String(row.identifier),
    limit: Number(row.limit),
    ttlMs: Number(row.ttl_ms),
    rejectedAt: row.rejected_at instanceof Date ? row.rejected_at : new Date(String(row.rejected_at)),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}
