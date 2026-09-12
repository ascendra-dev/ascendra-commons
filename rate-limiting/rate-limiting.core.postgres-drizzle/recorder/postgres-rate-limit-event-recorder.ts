import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { RateLimitEventRecorder, RateLimitRejection } from '../../rate-limiting.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { RATE_LIMIT_APPLICATION_ID, RATE_LIMIT_SQL_EXECUTOR } from '../tokens';

/**
 * Reference `RateLimitEventRecorder` for Postgres — one `INSERT` per
 * rejection. Honors the best-effort contract itself: a write failure is
 * logged and swallowed, never propagated (`RecordingThrottlerGuard` also
 * guards the call).
 */
@Injectable()
export class PostgresRateLimitEventRecorder implements RateLimitEventRecorder {
  private readonly logger = new Logger(PostgresRateLimitEventRecorder.name);

  constructor(
    @Inject(RATE_LIMIT_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(RATE_LIMIT_APPLICATION_ID) private readonly application: string,
  ) {}

  async recordRejection(rejection: RateLimitRejection): Promise<void> {
    try {
      await this.db.execute(sql`
        insert into commons_rate_limit_rejection (application, route, identifier, "limit", ttl_ms, rejected_at, correlation_id)
        values (
          ${this.application}, ${rejection.route}, ${rejection.identifier}, ${rejection.limit},
          ${rejection.ttlMs}, ${new Date()}, ${rejection.correlationId ?? null}
        )
      `);
    } catch (err) {
      this.logger.error(
        `Failed to record a rate-limit rejection for route "${rejection.route}" — the 429 itself is unaffected`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
