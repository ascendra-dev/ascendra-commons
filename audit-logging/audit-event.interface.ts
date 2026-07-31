/**
 * The persisted, immutable record. No UPDATE or DELETE is ever exposed against
 * this shape at the application layer — audit records are write-once.
 */
export interface AuditEvent {
  readonly id: string;
  readonly entityType: string; // 'invoice' | 'payment' | 'issuer' | ... — consumer-defined, not a fixed union here
  readonly entityId: string;
  /**
   * null for platform-level events with no single tenant — e.g. an admin
   * redefining a role's permissions in a platform-owned role catalog.
   * Mirrors an Actor's own tenantId nullability in the authorization pattern,
   * for the same reason.
   */
  readonly tenantId: string | null;
  /** A user id, or 'system:{job-name}' for a background job — see persist-audit-record.ts's consumer README example. */
  readonly actor: string;
  readonly action: string; // 'created' | 'status_changed' | 'approved' | ... — consumer-defined
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  /** Ties multiple audit events from one request or one background-job run together — see correlation-context.ts. */
  readonly correlationId: string;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

/** What a repository's insert() accepts — id is assigned by the persistence layer, never supplied by the caller. */
export type AuditEventInput = Omit<AuditEvent, 'id'>;
