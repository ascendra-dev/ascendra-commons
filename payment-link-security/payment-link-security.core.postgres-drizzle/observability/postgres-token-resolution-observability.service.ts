import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type ResolutionOutcomeCount,
  type ResolutionPage,
  type ResolutionQuery,
  type TokenResolutionObservabilityPort,
  type TokenResolutionRecord,
} from '../../payment-link-security.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { PAYMENT_LINK_APPLICATION_ID, PAYMENT_LINK_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reference `TokenResolutionObservabilityPort` for Postgres — one dynamic
 * `SELECT`, keyset-paginated newest-first, plus one aggregate query for
 * `outcomeCounts()`. Read-only. Scoped to one `application`.
 */
@Injectable()
export class PostgresTokenResolutionObservabilityService implements TokenResolutionObservabilityPort {
  constructor(
    @Inject(PAYMENT_LINK_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(PAYMENT_LINK_APPLICATION_ID) private readonly application: string,
  ) {}

  async listAttempts(query: ResolutionQuery = {}): Promise<ResolutionPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.outcome !== undefined) conds.push(sql`outcome = ${query.outcome}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`attempted_at >= ${query.since}`);
    if (query.until) conds.push(sql`attempted_at < ${query.until}`);

    const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cursor) {
      conds.push(sql`(attempted_at < ${cursor.timestamp} or (attempted_at = ${cursor.timestamp} and id < ${cursor.id}))`);
    }

    const rows = (
      await this.db.execute(sql`
        select id, token_hash, outcome, attempted_at, correlation_id
        from commons_payment_link_resolution
        where ${sql.join(conds, sql` and `)}
        order by attempted_at desc, id desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const attempts = rows.slice(0, limit);
      const last = attempts[attempts.length - 1];
      return { attempts, nextCursor: encodeKeysetCursor(last.attemptedAt, last.id) };
    }
    return { attempts: rows };
  }

  async outcomeCounts(since?: Date): Promise<ResolutionOutcomeCount[]> {
    const conds: SQL[] = [sql`application = ${this.application}`];
    if (since) conds.push(sql`attempted_at >= ${since}`);

    const { rows } = await this.db.execute(sql`
      select outcome, count(*) as count
      from commons_payment_link_resolution
      where ${sql.join(conds, sql` and `)}
      group by outcome
      order by outcome
    `);

    return rows.map((row) => ({
      outcome: row.outcome as ResolutionOutcomeCount['outcome'],
      count: Number(row.count),
    }));
  }
}

function mapRow(row: Record<string, unknown>): TokenResolutionRecord {
  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    outcome: row.outcome as TokenResolutionRecord['outcome'],
    attemptedAt: row.attempted_at instanceof Date ? row.attempted_at : new Date(String(row.attempted_at)),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}
