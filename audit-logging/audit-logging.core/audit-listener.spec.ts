import { describe, expect, it, vi } from 'vitest';
import { AuditListener } from './audit-listener';
import { AuditEventRepository } from './audit-event-repository.port';
import { AuditRecordRaised } from './audit-record-raised';

describe('AuditListener', () => {
  it('handle() does nothing but call persistAuditRecord() with the received event — the thin-dispatcher shape domain-events\' README cites', async () => {
    const auditRepo: AuditEventRepository = { insert: vi.fn().mockResolvedValue(undefined) };
    const listener = new AuditListener(auditRepo);
    const event = new AuditRecordRaised({ entityType: 'invoice', entityId: 'inv-1', tenantId: 'tenant-1', actor: 'user-1', action: 'status_changed', occurredAt: new Date() });

    await listener.handle(event);

    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'invoice', entityId: 'inv-1' }));
  });

  it('propagates a repository failure — never swallows it, since it is always wired via @OnCriticalEvent()', async () => {
    const auditRepo: AuditEventRepository = { insert: vi.fn().mockRejectedValue(new Error('db down')) };
    const listener = new AuditListener(auditRepo);
    const event = new AuditRecordRaised({ entityType: 'invoice', entityId: 'inv-1', tenantId: null, actor: 'user-1', action: 'status_changed', occurredAt: new Date() });

    await expect(listener.handle(event)).rejects.toThrow('db down');
  });
});
