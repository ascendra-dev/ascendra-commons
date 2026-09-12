import type { AuditEvent } from './audit-event.interface';

/**
 * Filter for reading audit records back — for a compliance/ops admin screen.
 * Every field is optional and ANDed; an omitted field is not constrained.
 * `tenantId` distinguishes absent (no tenant filter) from an explicit `null`
 * (only platform-level events, `tenant_id IS NULL`).
 *
 * `entityType`+`entityId` and `tenantId`+`occurredAfter`/`occurredBefore` are
 * the two indexed access paths (`commons_audit_event_entity_idx`,
 * `commons_audit_event_tenant_time_idx`). `actor`, `action`, `correlationId`
 * have no dedicated index — fine for their expected cardinality (a
 * correlation id is a handful of rows; `actor`/`action` are normally combined
 * with an indexed filter).
 */
export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  tenantId?: string | null;
  actor?: string;
  action?: string;
  correlationId?: string;
  occurredAfter?: Date;
  occurredBefore?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface AuditQueryResult {
  /** Newest first. */
  records: AuditEvent[];
  /** Present only when more records match — pass back as `AuditQuery.cursor`. */
  nextCursor?: string;
}

/**
 * The read port — deliberately separate from `AuditEventRepository` (which
 * stays `insert()`-only), so a consumer with a custom write repository isn't
 * forced to implement reads too, and "audit records are write-once" stays
 * self-evident from the write port's shape. This mirrors `background-jobs`'
 * split between `JobRunRecorder` (write) and `PostgresJobObservabilityService`
 * (read). `find()` never mutates.
 *
 * Never imported by feature code — an admin API module resolves it.
 */
export interface AuditEventReader {
  find(query: AuditQuery): Promise<AuditQueryResult>;
}
