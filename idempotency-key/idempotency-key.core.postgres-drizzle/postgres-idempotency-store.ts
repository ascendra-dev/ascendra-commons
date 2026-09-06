import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CachedResponse, ClaimResult, IdempotencyStore, IdempotencyStoreOptions } from '../idempotency-key.core';
import type { SqlExecutor } from './persistence/sql-executor';
import { IDEMPOTENCY_SQL_EXECUTOR, IDEMPOTENCY_STORE_OPTIONS } from './tokens';

/** What the fallback/classify path returns — a `ClaimResult` minus `'claimed'`. */
type ExistingResult = Exclude<ClaimResult, { status: 'claimed' }>;

/**
 * The atomic claim for Postgres/Drizzle (Model 1). Corresponding table:
 * `persistence/idempotency-key.schema.ts` / `idempotency-key.migration.sql`.
 *
 * `claim()` is one `INSERT … ON CONFLICT DO UPDATE … WHERE (stale) … RETURNING` —
 * atomic regardless of node, the guarantee from Postgres's conflict handling on
 * the `(key, scope)` primary key. A fresh insert *and* a stale-reclaim both
 * return one row (`rows.length === 1` = "I own it"); a recent-pending or
 * completed conflict returns zero, and the fallback read classifies it.
 *
 * Every claim carries a fresh `claim_id`. `complete()` is guarded
 * `WHERE claim_id = $claimId`, so a claim reclaimed as stale (its `claim_id`
 * overwritten by the new owner) can no longer write its response — its
 * `complete()` is a silent 0-row no-op instead of corrupting the current
 * owner's cached response. This does not stop the duplicate side-effect (once
 * a still-in-flight claim is reclaimed by time, both run) — it keeps the cache
 * consistent with what the current owner's client saw.
 */
@Injectable()
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(
    @Inject(IDEMPOTENCY_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(IDEMPOTENCY_STORE_OPTIONS) private readonly options: IdempotencyStoreOptions,
  ) {}

  async claim(key: string, scope: string): Promise<ClaimResult> {
    const claimId = randomUUID();

    const won = await this.db.execute(sql`
      insert into commons_idempotency_key (key, scope, status, claim_id)
      values (${key}, ${scope}, 'pending', ${claimId})
      on conflict (key, scope) do update
        set status = 'pending', created_at = now(), claim_id = ${claimId}
        where commons_idempotency_key.status = 'pending'
          and commons_idempotency_key.created_at < now() - make_interval(secs => ${this.options.staleAfterSeconds})
      returning claim_id
    `);
    if (won.rows.length === 1) return { status: 'claimed', claimId };

    let row = await this.readRow(key, scope);
    if (!row) {
      // The row this same attempt just failed to win could have been deleted (a cleanup job)
      // between that attempt and this read. Re-claim race-safely — never just report 'claimed'
      // without writing the row (complete() would have nothing to update, no concurrent
      // duplicate would be caught), and never a plain INSERT that PK-violates on a concurrent
      // re-claim.
      const reclaimed = await this.db.execute(sql`
        insert into commons_idempotency_key (key, scope, status, claim_id)
        values (${key}, ${scope}, 'pending', ${claimId})
        on conflict (key, scope) do nothing
        returning claim_id
      `);
      if (reclaimed.rows.length === 1) return { status: 'claimed', claimId };
      row = await this.readRow(key, scope); // someone else won the re-claim — read their row
    }
    return this.classify(row);
  }

  async complete(key: string, scope: string, claimId: string, response: CachedResponse): Promise<void> {
    await this.db.execute(sql`
      update commons_idempotency_key
      set status = 'completed', status_code = ${response.statusCode}, response_body = ${response.body}
      where key = ${key} and scope = ${scope} and claim_id = ${claimId}
    `);
  }

  private async readRow(key: string, scope: string): Promise<Record<string, unknown> | undefined> {
    const { rows } = await this.db.execute(sql`
      select status, status_code, response_body from commons_idempotency_key where key = ${key} and scope = ${scope}
    `);
    return rows[0];
  }

  private classify(row: Record<string, unknown> | undefined): ExistingResult {
    if (!row) return { status: 'in_progress' }; // pathological: deleted again mid-race; treat as concurrent
    return row.status === 'completed'
      ? { status: 'completed', response: { statusCode: row.status_code as number, body: row.response_body } }
      : { status: 'in_progress' };
  }
}
