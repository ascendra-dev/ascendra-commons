import { describe, expect, it, vi } from 'vitest';
import { persistAuditRecord } from './persist-audit-record';
import { AuditEventRepository } from './audit-event-repository';
import { AuditableDomainEvent } from './auditable-domain-event.interface';
import { runWithCorrelationId } from './correlation-context';

function fakeEvent(overrides: Partial<ReturnType<AuditableDomainEvent['toAuditRecord']>> = {}): AuditableDomainEvent {
  const occurredAt = new Date('2026-01-03T10:00:00Z');
  return {
    occurredAt,
    toAuditRecord: () => ({
      entityType: 'invoice',
      entityId: 'inv-1',
      tenantId: 'tenant-1',
      actor: 'user-1',
      action: 'status_changed',
      before: { status: 'sent' },
      after: { status: 'paid' },
      ...overrides,
    }),
  };
}

describe('persistAuditRecord', () => {
  it('inserts the mapped record with the event\'s own occurredAt, not "now"', async () => {
    const auditRepo: AuditEventRepository = { insert: vi.fn().mockResolvedValue(undefined) };
    const event = fakeEvent();

    await persistAuditRecord(auditRepo, event);

    expect(auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'invoice',
        entityId: 'inv-1',
        tenantId: 'tenant-1',
        actor: 'user-1',
        action: 'status_changed',
        before: { status: 'sent' },
        after: { status: 'paid' },
        occurredAt: event.occurredAt,
      }),
    );
  });

  it('normalizes an omitted reason to null, not undefined, to match AuditEvent.reason\'s required type', async () => {
    const auditRepo: AuditEventRepository = { insert: vi.fn().mockResolvedValue(undefined) };

    await persistAuditRecord(auditRepo, fakeEvent());

    const inserted = (auditRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted.reason).toBeNull();
  });

  it('preserves an explicit reason when the event provides one', async () => {
    const auditRepo: AuditEventRepository = { insert: vi.fn().mockResolvedValue(undefined) };

    await persistAuditRecord(auditRepo, fakeEvent({ reason: 'manual override' }));

    const inserted = (auditRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted.reason).toBe('manual override');
  });

  it('reads the ambient correlation id when inside a runWithCorrelationId scope', async () => {
    const auditRepo: AuditEventRepository = { insert: vi.fn().mockResolvedValue(undefined) };

    await runWithCorrelationId('run-123', async () => {
      await persistAuditRecord(auditRepo, fakeEvent());
    });

    const inserted = (auditRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted.correlationId).toBe('run-123');
  });

  it('propagates a repository insert failure — never swallows it itself', async () => {
    const auditRepo: AuditEventRepository = { insert: vi.fn().mockRejectedValue(new Error('db down')) };

    await expect(persistAuditRecord(auditRepo, fakeEvent())).rejects.toThrow('db down');
  });

  it('tenantId can be null — a platform-level event with no single tenant', async () => {
    const auditRepo: AuditEventRepository = { insert: vi.fn().mockResolvedValue(undefined) };

    await persistAuditRecord(auditRepo, fakeEvent({ tenantId: null }));

    const inserted = (auditRepo.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted.tenantId).toBeNull();
  });
});
