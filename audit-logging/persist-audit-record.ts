import type { AuditEventRepository } from './audit-event-repository';
import type { AuditableDomainEvent } from './auditable-domain-event.interface';
import { getCurrentCorrelationId } from './correlation-context';

/**
 * The one piece of real logic this pattern ships. Deliberately a plain
 * function, not a shipped listener class — which specific event names get
 * audited is project-specific (invoice/payment domain in one project, a
 * completely different one elsewhere), so this library cannot ship a
 * pre-wired @OnCriticalEvent()-decorated class without baking in someone
 * else's event names. The consumer writes their own small listener class
 * using @OnCriticalEvent() for whichever events they choose, and calls this
 * function from its body — see this pattern's README for the worked example.
 *
 * @OnCriticalEvent(), not @OnEvent(), is the consumer's responsibility to use
 * on that listener — plain @OnEvent() defaults to suppressErrors: true
 * (domain-events pattern), which would silently swallow a failed insert()
 * below instead of propagating it, defeating the reason this function exists.
 */
export async function persistAuditRecord(
  auditRepo: AuditEventRepository,
  event: AuditableDomainEvent,
): Promise<void> {
  const record = event.toAuditRecord();
  await auditRepo.insert({
    ...record,
    reason: record.reason ?? null, // toAuditRecord()'s reason is optional; AuditEvent's is not — normalize here, once
    correlationId: getCurrentCorrelationId(),
    occurredAt: event.occurredAt, // the business fact's own time, not "now" — see AuditableDomainEvent's doc comment
  });
}
