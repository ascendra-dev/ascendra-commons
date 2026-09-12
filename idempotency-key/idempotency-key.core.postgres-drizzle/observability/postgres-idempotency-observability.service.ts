import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type CachedResponse,
  type ClaimHealthSummary,
  type ClaimPage,
  type ClaimQuery,
  type IdempotencyClaimRecord,
  type IdempotencyObservabilityPort,
} from '../../idempotency-key.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { IDEMPOTENCY_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reference `IdempotencyObservabilityPort` for Postgres — one library-owned
 * `SELECT` with a dynamic `WHERE`, keyset-paginated newest-first, plus one
 * aggregate query for `claimHealthSummary()`. Read-only — no
 * `INSERT`/`UPDATE`/`DELETE` path exists here; writes stay
 * `PostgresIdempotencyStore`'s alone.
 *
 * No `application` scoping — the module's own stance (see `idempotency-key`'s
 * README) is that a claim never leaves the store, and that isn't changed by
 * adding a read path over it.
 */
@Injectable()
export class PostgresIdempotencyObservabilityService implements IdempotencyObservabilityPort {
  constructor(@Inject(IDEMPOTENCY_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async getClaim(key: string, scope: string): Promise<IdempotencyClaimRecord | null> {
    const { rows } = await this.db.execute(sql`
      select key, scope, status, status_code, response_body, created_at, reclaim_count, late_complete_no_op_count, correlation_id
      from commons_idempotency_key
      where key = ${key} and scope = ${scope}
    `);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listClaims(query: ClaimQuery = {}): Promise<ClaimPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [];
    if (query.status !== undefined) conds.push(sql`status = ${query.status}`);
    if (query.scope !== undefined) conds.push(sql`scope = ${query.scope}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`created_at >= ${query.since}`);
    if (query.until) conds.push(sql`created_at < ${query.until}`);

    const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cursor) {
      conds.push(
        sql`(created_at < ${cursor.timestamp}
          or (created_at = ${cursor.timestamp} and (key, scope) < (${cursor.key}, ${cursor.scope})))`,
      );
    }

    const where = conds.length > 0 ? sql`where ${sql.join(conds, sql` and `)}` : sql``;

    const rows = (
      await this.db.execute(sql`
        select key, scope, status, status_code, response_body, created_at, reclaim_count, late_complete_no_op_count, correlation_id
        from commons_idempotency_key
        ${where}
        order by created_at desc, key desc, scope desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const claims = rows.slice(0, limit);
      const last = claims[claims.length - 1];
      return { claims, nextCursor: encodeKeysetCursor(last.createdAt, last.key, last.scope) };
    }
    return { claims: rows };
  }

  async claimHealthSummary(): Promise<ClaimHealthSummary> {
    const { rows } = await this.db.execute(sql`
      select
        count(*) filter (where status = 'pending') as pending_count,
        count(*) filter (where status = 'completed') as completed_count,
        count(*) filter (where reclaim_count > 0) as reclaimed_count,
        coalesce(sum(late_complete_no_op_count), 0) as late_complete_no_op_total,
        count(*) as total_count,
        min(created_at) as oldest_retained_at
      from commons_idempotency_key
    `);
    const row = rows[0] ?? {};
    return {
      pendingCount: Number(row.pending_count ?? 0),
      completedCount: Number(row.completed_count ?? 0),
      reclaimedCount: Number(row.reclaimed_count ?? 0),
      lateCompleteNoOpTotal: Number(row.late_complete_no_op_total ?? 0),
      totalCount: Number(row.total_count ?? 0),
      oldestRetainedAt:
        row.oldest_retained_at == null
          ? null
          : row.oldest_retained_at instanceof Date
            ? row.oldest_retained_at
            : new Date(String(row.oldest_retained_at)),
    };
  }
}

function mapRow(row: Record<string, unknown>): IdempotencyClaimRecord {
  const response: CachedResponse | null =
    row.status === 'completed' ? { statusCode: row.status_code as number, body: row.response_body } : null;
  return {
    key: String(row.key),
    scope: String(row.scope),
    status: row.status as IdempotencyClaimRecord['status'],
    response,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    reclaimCount: Number(row.reclaim_count),
    lateCompleteNoOpCount: Number(row.late_complete_no_op_count),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}
