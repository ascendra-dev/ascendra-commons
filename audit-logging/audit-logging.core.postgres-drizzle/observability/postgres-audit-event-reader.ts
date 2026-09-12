import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type AuditEvent,
  type AuditEventReader,
  type AuditQuery,
  type AuditQueryResult,
} from '../../audit-logging.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { AUDIT_APPLICATION_ID, AUDIT_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reference `AuditEventReader` for Postgres via Drizzle — one library-owned
 * `SELECT` with a dynamic `WHERE`, keyset-paginated newest-first. Read-only:
 * no `INSERT`/`UPDATE`/`DELETE` path exists, so "audit records are write-once"
 * holds exactly as before.
 *
 * Scoped to one `application` — an app's own compliance/ops screen. A
 * cross-product compliance view that needs *every* app's rows queries
 * `commons_audit_event` directly.
 *
 * Corresponding table: `../persistence/audit-event.schema.ts` / `.migration.sql`.
 */
@Injectable()
export class PostgresAuditEventReader implements AuditEventReader {
  constructor(
    @Inject(AUDIT_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(AUDIT_APPLICATION_ID) private readonly application: string,
  ) {}

  async find(query: AuditQuery): Promise<AuditQueryResult> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.entityType !== undefined) conds.push(sql`entity_type = ${query.entityType}`);
    if (query.entityId !== undefined) conds.push(sql`entity_id = ${query.entityId}`);
    if ('tenantId' in query) {
      conds.push(query.tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${query.tenantId}`);
    }
    if (query.actor !== undefined) conds.push(sql`actor = ${query.actor}`);
    if (query.action !== undefined) conds.push(sql`action = ${query.action}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.occurredAfter) conds.push(sql`occurred_at >= ${query.occurredAfter}`);
    if (query.occurredBefore) conds.push(sql`occurred_at < ${query.occurredBefore}`);

    const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cursor) {
      conds.push(
        sql`(occurred_at < ${cursor.timestamp} or (occurred_at = ${cursor.timestamp} and id < ${cursor.id}))`,
      );
    }

    const rows = (
      await this.db.execute(sql`
        select id, entity_type, entity_id, tenant_id, actor, action, before, after, correlation_id, reason, occurred_at
        from commons_audit_event
        where ${sql.join(conds, sql` and `)}
        order by occurred_at desc, id desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const records = rows.slice(0, limit);
      const last = records[records.length - 1];
      return { records, nextCursor: encodeKeysetCursor(last.occurredAt, last.id) };
    }
    return { records: rows };
  }
}

function mapRow(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    tenantId: row.tenant_id == null ? null : String(row.tenant_id),
    actor: String(row.actor),
    action: String(row.action),
    before: (row.before ?? null) as Record<string, unknown> | null,
    after: (row.after ?? null) as Record<string, unknown> | null,
    correlationId: String(row.correlation_id),
    reason: row.reason == null ? null : String(row.reason),
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at)),
  };
}
