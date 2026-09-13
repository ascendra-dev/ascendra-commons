import { describe, expect, it } from 'vitest';
import { renderAuditEventsCsv } from './audit-events-csv';
import type { AuditEvent } from '../audit-logging.core';

function event(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'ae-1',
    entityType: 'invoice',
    entityId: 'inv-1',
    tenantId: 't-1',
    actor: 'u-1',
    action: 'status_changed',
    before: { status: 'sent' },
    after: { status: 'paid' },
    correlationId: 'trace-1',
    reason: null,
    occurredAt: new Date('2026-09-07T09:41:02.481Z'),
    ...over,
  };
}

describe('renderAuditEventsCsv', () => {
  it('emits a header row and one line per record', () => {
    const csv = renderAuditEventsCsv([event()]);
    const lines = csv.trim().split('\r\n');

    expect(lines[0]).toBe('id,occurredAt,entityType,entityId,tenantId,actor,action,before,after,correlationId,reason');
    expect(lines[1]).toBe(
      'ae-1,2026-09-07T09:41:02.481Z,invoice,inv-1,t-1,u-1,status_changed,"{""status"":""sent""}","{""status"":""paid""}",trace-1,',
    );
  });

  it('renders only the header row for an empty result set', () => {
    expect(renderAuditEventsCsv([])).toBe('id,occurredAt,entityType,entityId,tenantId,actor,action,before,after,correlationId,reason\r\n');
  });

  it('renders null tenantId and reason as empty fields', () => {
    const csv = renderAuditEventsCsv([event({ tenantId: null, reason: null, before: null, after: null })]);
    const [, dataLine] = csv.trim().split('\r\n');
    expect(dataLine).toBe('ae-1,2026-09-07T09:41:02.481Z,invoice,inv-1,,u-1,status_changed,,,trace-1,');
  });

  it('quotes and escapes a field containing a comma or double quote', () => {
    const csv = renderAuditEventsCsv([event({ reason: 'Marked "paid", after reconciliation' })]);
    expect(csv).toContain('"Marked ""paid"", after reconciliation"');
  });
});
