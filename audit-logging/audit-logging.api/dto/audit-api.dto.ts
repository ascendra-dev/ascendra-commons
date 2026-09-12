/**
 * Request shapes for `audit-logging.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. The controller reads query strings; the `.api`
 * service parses dates and applies the actor-scoped tenant filter.
 */
export interface AuditEventsQueryDto {
  entityType?: string;
  entityId?: string;
  /** Only honored for a platform admin; a non-platform actor is pinned to their own tenant. `'null'` = platform-level rows. */
  tenantId?: string;
  actor?: string;
  action?: string;
  correlationId?: string;
  occurredAfter?: string;
  occurredBefore?: string;
  limit?: number;
  cursor?: string;
}
