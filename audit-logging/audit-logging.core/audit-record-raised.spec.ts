import { describe, expect, it } from 'vitest';
import { AuditRecordRaised } from './audit-record-raised';

describe('AuditRecordRaised', () => {
  const occurredAt = new Date('2026-10-01T09:00:00Z');

  it('carries every named field as given', () => {
    const event = new AuditRecordRaised({
      entityType: 'invoice',
      entityId: 'inv-1',
      tenantId: 'tenant_acme',
      actor: 'admin@acme.test',
      action: 'status_changed',
      before: { status: 'sent' },
      after: { status: 'paid' },
      occurredAt,
      reason: 'customer paid by wire',
    });
    expect(event).toMatchObject({
      entityType: 'invoice', entityId: 'inv-1', tenantId: 'tenant_acme', actor: 'admin@acme.test',
      action: 'status_changed', before: { status: 'sent' }, after: { status: 'paid' }, occurredAt, reason: 'customer paid by wire',
    });
  });

  it('defaults before, after and reason to null — a create omits before, a delete omits after', () => {
    const created = new AuditRecordRaised({
      entityType: 'invoice', entityId: 'inv-2', tenantId: null, actor: 'u1', action: 'created', after: { total: 10 }, occurredAt,
    });
    expect(created.before).toBeNull();
    expect(created.reason).toBeNull();
    expect(created.tenantId).toBeNull();
  });
});
