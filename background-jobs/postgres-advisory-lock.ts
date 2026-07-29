import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AdvisoryLock } from './advisory-lock';
import { SqlExecutor } from './sql-executor';
import { SQL_EXECUTOR } from './tokens';

/**
 * Postgres session-level advisory locks (Model 1). hashtext() folds an
 * arbitrary string key into the bigint pg_try_advisory_lock() needs, so
 * callers never manage numeric lock ids themselves. Session-scoped locks are
 * released automatically by Postgres when the holding connection closes, so
 * a crashed process never leaves one stuck — nothing here has to handle that
 * case explicitly.
 */
@Injectable()
export class PostgresAdvisoryLock implements AdvisoryLock {
  constructor(@Inject(SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async tryAcquire(key: string): Promise<boolean> {
    const result = await this.db.execute(sql`select pg_try_advisory_lock(hashtext(${key})) as acquired`);
    return result.rows[0]?.acquired === true;
  }

  async release(key: string): Promise<void> {
    await this.db.execute(sql`select pg_advisory_unlock(hashtext(${key})) as released`);
  }
}
