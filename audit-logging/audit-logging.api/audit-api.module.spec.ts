import { describe, expect, it, vi } from 'vitest';
import { Module, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUDIT_EVENT_READER } from '../audit-logging.core';
import type { AuditEvent } from '../audit-logging.core';
import { AuditApiModule } from './audit-api.module';
import { AuditEventsController } from './audit-events.controller';
import type { Actor } from '../../authorization/authorization.core';

function auditEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'ae-1',
    entityType: 'invoice',
    entityId: 'inv-1',
    tenantId: 't1',
    actor: 'u1',
    action: 'status_changed',
    before: { status: 'sent' },
    after: { status: 'paid' },
    correlationId: 'trace-1',
    reason: null,
    occurredAt: new Date('2026-09-07T09:41:02Z'),
    ...over,
  };
}

const find = vi.fn().mockResolvedValue({ records: [] });
const findOne = vi.fn().mockResolvedValue(null);
const summarizeActor = vi.fn().mockResolvedValue({
  actor: 'u1',
  firstSeen: null,
  lastSeen: null,
  totalRecords: 0,
  tenantsTouched: [],
  byAction: [],
});
const stats = vi.fn().mockResolvedValue({ window: '30d', perDay: [], topActions: [], topActors: [], perTenant: [] });
const countByDeclared = vi.fn().mockResolvedValue([]);

@Module({
  providers: [{ provide: AUDIT_EVENT_READER, useValue: { find, findOne, summarizeActor, stats, countByDeclared } }],
  exports: [AUDIT_EVENT_READER],
})
class FakeReaderModule {}

describe('AuditApiModule.forRoot — real DI wiring', () => {
  async function build() {
    return Test.createTestingModule({
      imports: [AuditApiModule.forRoot({ imports: [FakeReaderModule] })],
    }).compile();
  }

  it('resolves the controller', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(AuditEventsController)).toBeInstanceOf(AuditEventsController);
  });

  it('routes GET /audit/events through to the reader, tenant-scoped for a non-platform actor', async () => {
    const moduleRef = await build();
    const tenantActor: Actor = { id: 'a1', persona: 'compliance', tenantId: 't1' };
    await moduleRef.get(AuditEventsController).events(tenantActor, 'invoice');
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'invoice', tenantId: 't1' }));
  });

  it('routes GET /audit/trace/:correlationId', async () => {
    const moduleRef = await build();
    const platformActor: Actor = { id: 'p1', persona: 'platform', tenantId: null };
    await moduleRef.get(AuditEventsController).trace(platformActor, 'trace-9');
    expect(find).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: 'trace-9' }));
  });

  it('routes GET /audit/events/:id to a found record, with its diff', async () => {
    const moduleRef = await build();
    const platformActor: Actor = { id: 'p1', persona: 'platform', tenantId: null };
    findOne.mockResolvedValueOnce(auditEvent());

    const detail = await moduleRef.get(AuditEventsController).event(platformActor, 'ae-1');
    expect(detail).toMatchObject({ id: 'ae-1', diff: [{ field: 'status', before: 'sent', after: 'paid' }] });
    expect(findOne).toHaveBeenCalledWith('ae-1', undefined);
  });

  it('404s GET /audit/events/:id when the record does not exist', async () => {
    const moduleRef = await build();
    const platformActor: Actor = { id: 'p1', persona: 'platform', tenantId: null };
    findOne.mockResolvedValueOnce(null);

    await expect(moduleRef.get(AuditEventsController).event(platformActor, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides a cross-tenant record behind the same 404 for a non-platform actor', async () => {
    const moduleRef = await build();
    const tenantActor: Actor = { id: 'a1', persona: 'compliance', tenantId: 't1' };
    findOne.mockResolvedValueOnce(null); // the fake reader enforces the tenant filter it was given

    await expect(moduleRef.get(AuditEventsController).event(tenantActor, 'someone-elses-record')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findOne).toHaveBeenCalledWith('someone-elses-record', 't1');
  });

  it('routes GET /audit/events.csv through find() and renders CSV', async () => {
    const moduleRef = await build();
    const platformActor: Actor = { id: 'p1', persona: 'platform', tenantId: null };
    find.mockResolvedValueOnce({ records: [auditEvent()] });

    const csv = await moduleRef.get(AuditEventsController).eventsCsv(platformActor, 'invoice');
    expect(csv).toContain('id,occurredAt,entityType');
    expect(csv).toContain('ae-1');
  });

  it('routes GET /audit/actors/:actor/activity, tenant-scoped for a non-platform actor', async () => {
    const moduleRef = await build();
    const tenantActor: Actor = { id: 'a1', persona: 'compliance', tenantId: 't1' };
    await moduleRef.get(AuditEventsController).actorActivity(tenantActor, 'u1');
    expect(summarizeActor).toHaveBeenCalledWith('u1', expect.objectContaining({ tenantId: 't1' }));
  });

  it('routes GET /audit/stats, tenant-scoped for a non-platform actor', async () => {
    const moduleRef = await build();
    const tenantActor: Actor = { id: 'a1', persona: 'compliance', tenantId: 't1' };
    await moduleRef.get(AuditEventsController).stats(tenantActor);
    expect(stats).toHaveBeenCalledWith('30d', 't1');
  });

  it('routes POST /audit/coverage', async () => {
    const moduleRef = await build();
    const platformActor: Actor = { id: 'p1', persona: 'platform', tenantId: null };
    await moduleRef.get(AuditEventsController).coverage(platformActor, { entityTypes: ['invoice'], actions: [] });
    expect(countByDeclared).toHaveBeenCalledWith({ entityTypes: ['invoice'], actions: [] });
  });
});
