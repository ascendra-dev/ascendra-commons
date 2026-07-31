import type { DomainEvent } from '../domain-events';

/**
 * How an arbitrary domain event describes itself as an audit record. Extends
 * DomainEvent (not a separate occurredAt field here) specifically so
 * persist-audit-record.ts can read the event's own occurrence time directly —
 * the moment the business fact happened, not the moment the audit write
 * happened to run, which is what DomainEvent.occurredAt's own doc comment
 * already names this interface as the reason for existing.
 *
 * Feature code never constructs an AuditEvent directly — that would re-couple
 * business code to the audit concern, exactly what this pattern exists to
 * avoid. It raises a domain event (per the domain-events pattern) whose
 * payload already carries the facts of what changed; the event maps itself
 * to an audit record here, so a generic listener never grows a per-entity-type
 * switch statement as new auditable events are added.
 */
export interface AuditableDomainEvent extends DomainEvent {
  toAuditRecord(): {
    entityType: string;
    entityId: string;
    tenantId: string | null;
    actor: string;
    action: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason?: string | null;
  };
}
