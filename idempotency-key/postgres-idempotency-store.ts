import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CachedResponse } from './cached-response.interface';
import type { ClaimResult } from './claim-result';
import type { IdempotencyStore } from './idempotency-store';
import type { IdempotencyStoreOptions } from './idempotency-store-options';
import type { SqlExecutor } from './sql-executor';
import { IDEMPOTENCY_STORE_OPTIONS, SQL_EXECUTOR } from './tokens';

/**
 * Corresponding table:
 *
 * create table commons_idempotency_key (
 *   key text not null,
 *   scope text not null,
 *   status text not null default 'pending',  -- 'pending' | 'completed'
 *   status_code int,
 *   response_body jsonb,
 *   created_at timestamptz not null default now(),
 *   primary key (key, scope)
 * );
 */
@Injectable()
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(
    @Inject(SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(IDEMPOTENCY_STORE_OPTIONS) private readonly options: IdempotencyStoreOptions,
  ) {}

  async claim(key: string, scope: string): Promise<ClaimResult> {
    // Atomic regardless of which server node issues it — the guarantee comes from Postgres's
    // own conflict handling on the (key, scope) primary key, not from in-process coordination.
    const claimed = await this.db.execute(sql`
      insert into commons_idempotency_key (key, scope, status)
      values (${key}, ${scope}, 'pending')
      on conflict (key, scope) do update
        set status = 'pending', created_at = now()
        where commons_idempotency_key.status = 'pending'
          and commons_idempotency_key.created_at < now() - make_interval(secs => ${this.options.staleAfterSeconds})
      returning status
    `);
    if (claimed.rowCount === 1) return { status: 'claimed' };

    const existing = await this.db.execute(
      sql`select status, status_code, response_body from commons_idempotency_key where key = ${key} and scope = ${scope}`,
    );
    const row = existing.rows[0];
    // Defensive: the row this same claim attempt just failed to win could, in principle, be
    // deleted between that attempt and this read (a cleanup job, most plausibly). Nothing to
    // conflict with anymore, so a plain insert now genuinely claims it — this must not just
    // report 'claimed' without ever having written the row, or complete() below would have
    // nothing to update and no concurrent duplicate would be caught.
    if (!row) {
      await this.db.execute(sql`insert into commons_idempotency_key (key, scope, status) values (${key}, ${scope}, 'pending')`);
      return { status: 'claimed' };
    }
    return row.status === 'completed'
      ? { status: 'completed', response: { statusCode: row.status_code as number, body: row.response_body } }
      : { status: 'in_progress' };
  }

  async complete(key: string, scope: string, response: CachedResponse): Promise<void> {
    await this.db.execute(sql`
      update commons_idempotency_key set status = 'completed', status_code = ${response.statusCode}, response_body = ${response.body}
      where key = ${key} and scope = ${scope}
    `);
  }
}
