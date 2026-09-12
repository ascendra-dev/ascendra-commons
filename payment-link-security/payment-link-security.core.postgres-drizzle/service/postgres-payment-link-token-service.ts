import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PaymentLinkTokenService, TokenResolutionRecorder } from '../../payment-link-security.core';
import { NoopTokenResolutionRecorder, TOKEN_RESOLUTION_RECORDER } from '../../payment-link-security.core';
import { hashToken } from '../hash-token';
import type { SqlExecutor } from '../persistence/sql-executor';
import { PAYMENT_LINK_APPLICATION_ID, PAYMENT_LINK_SQL_EXECUTOR } from '../tokens';

const TOKEN_BYTES = 32;

/**
 * Reference `PaymentLinkTokenService` for Postgres. Corresponding table:
 * `../persistence/payment-link-token.schema.ts` / `.migration.sql`.
 *
 * **Never stores or logs the raw token** — `generate()` returns it once (the
 * caller embeds it in the link URL); everywhere else, only its SHA-256 hash
 * is ever touched (`hash-token.ts`). `resolve()` hashes the incoming token
 * and looks up by hash — a leaked `commons_payment_link_token` row never
 * hands back a usable token, the same posture a password gets.
 *
 * `resolve()` distinguishes `'not_found'` from `'revoked'` (both return
 * `null` to the caller — see the port's own doc comment on why a caller
 * cannot and should not tell the difference) so the resolution log can, for
 * an ops screen deciding whether an elevated `not_found` rate is an
 * enumeration attempt or routine stale-link clicks.
 */
@Injectable()
export class PostgresPaymentLinkTokenService implements PaymentLinkTokenService {
  private readonly logger = new Logger(PostgresPaymentLinkTokenService.name);
  private readonly recorder: TokenResolutionRecorder;

  constructor(
    @Inject(PAYMENT_LINK_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(PAYMENT_LINK_APPLICATION_ID) private readonly application: string,
    @Optional() @Inject(TOKEN_RESOLUTION_RECORDER) recorder?: TokenResolutionRecorder,
  ) {
    this.recorder = recorder ?? new NoopTokenResolutionRecorder();
  }

  async generate(resourceId: string, subjectId: string): Promise<{ token: string }> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    await this.db.execute(sql`
      insert into commons_payment_link_token (application, token_hash, resource_id, subject_id)
      values (${this.application}, ${hashToken(token)}, ${resourceId}, ${subjectId})
    `);
    return { token };
  }

  async resolve(token: string, correlationId?: string): Promise<{ resourceId: string; subjectId: string } | null> {
    const { rows } = await this.db.execute(sql`
      select resource_id, subject_id, revoked_at
      from commons_payment_link_token
      where application = ${this.application} and token_hash = ${hashToken(token)}
    `);
    const row = rows[0];

    if (!row) {
      await this.recordAttempt(token, 'not_found', correlationId);
      return null;
    }
    if (row.revoked_at != null) {
      await this.recordAttempt(token, 'revoked', correlationId);
      return null;
    }

    await this.recordAttempt(token, 'resolved', correlationId);
    return { resourceId: String(row.resource_id), subjectId: String(row.subject_id) };
  }

  async revoke(resourceId: string): Promise<void> {
    await this.db.execute(sql`
      update commons_payment_link_token
      set revoked_at = now()
      where application = ${this.application} and resource_id = ${resourceId} and revoked_at is null
    `);
  }

  /** Never throws — a resolution-log failure must never change what resolve() returns. */
  private async recordAttempt(
    token: string,
    outcome: 'resolved' | 'not_found' | 'revoked',
    correlationId?: string,
  ): Promise<void> {
    try {
      await this.recorder.recordAttempt(token, { outcome, correlationId });
    } catch (err) {
      this.logger.error(
        `Recording a resolution attempt (outcome "${outcome}") failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
