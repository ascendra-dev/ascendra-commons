import type { AuditEvent } from '../audit-logging.core';

/**
 * Renders a page of `AuditEvent`s as CSV, for `GET /audit/events.csv` — the
 * Export screen's "small range" path. Reuses the same bounded `find()`/
 * `AuditQuery` the JSON list endpoint uses; there is deliberately no
 * unbounded/async export-to-file-storage flow here (see the module README's
 * "what's not built" and the mock's Export screen note — that's a separate,
 * explicitly out-of-scope piece of work).
 *
 * `before`/`after` are serialized as JSON strings, one column each — a
 * spreadsheet consumer can still read the flat fields without them.
 */
const COLUMNS = [
  'id',
  'occurredAt',
  'entityType',
  'entityId',
  'tenantId',
  'actor',
  'action',
  'before',
  'after',
  'correlationId',
  'reason',
] as const;

export function renderAuditEventsCsv(records: readonly AuditEvent[]): string {
  const lines = [COLUMNS.join(',')];
  for (const record of records) {
    lines.push(
      [
        record.id,
        record.occurredAt.toISOString(),
        record.entityType,
        record.entityId,
        record.tenantId ?? '',
        record.actor,
        record.action,
        record.before ? JSON.stringify(record.before) : '',
        record.after ? JSON.stringify(record.after) : '',
        record.correlationId,
        record.reason ?? '',
      ]
        .map(csvField)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
