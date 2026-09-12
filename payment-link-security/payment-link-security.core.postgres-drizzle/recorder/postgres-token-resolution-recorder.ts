import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TokenResolutionAttempt, TokenResolutionRecorder } from '../../payment-link-security.core';
import { hashToken } from '../hash-token';
import type { SqlExecutor } from '../persistence/sql-executor';
import { PAYMENT_LINK_APPLICATION_ID, PAYMENT_LINK_SQL_EXECUTOR } from '../tokens';

/**
 * Reference `TokenResolutionRecorder` for Postgres — one `INSERT` per
 * `resolve()` call. Honors the best-effort contract itself: a write failure
 * is logged and swallowed, never propagated (`PostgresPaymentLinkTokenService`
 * also guards the call). Hashes the token itself — the raw value is never
 * written, even transiently, into this method's own SQL.
 */
@Injectable()
export class PostgresTokenResolutionRecorder implements TokenResolutionRecorder {
  private readonly logger = new Logger(PostgresTokenResolutionRecorder.name);

  constructor(
    @Inject(PAYMENT_LINK_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(PAYMENT_LINK_APPLICATION_ID) private readonly application: string,
  ) {}

  async recordAttempt(token: string, attempt: TokenResolutionAttempt): Promise<void> {
    try {
      await this.db.execute(sql`
        insert into commons_payment_link_resolution (application, token_hash, outcome, attempted_at, correlation_id)
        values (${this.application}, ${hashToken(token)}, ${attempt.outcome}, ${new Date()}, ${attempt.correlationId ?? null})
      `);
    } catch (err) {
      this.logger.error(
        `Failed to record a resolution-attempt row (outcome "${attempt.outcome}") — the resolve() outcome is unaffected`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
