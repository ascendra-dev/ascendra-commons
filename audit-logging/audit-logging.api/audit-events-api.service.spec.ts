import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditEventsApiService } from './audit-events-api.service';
import type { AuditEvent, AuditEventReader } from '../audit-logging.core';
import type { AuditApiOptions } from './audit-api.options';
import type { Actor } from '../../authorization/authorization.core';

function deps(isPlatformAdmin: AuditApiOptions['isPlatformAdmin'] = (a) => a.tenantId === null) {
  const reader: AuditEventReader = {
    find: vi.fn().mockResolvedValue({ records: [] }),
    findOne: vi.fn().mockResolvedValue(null),
    summarizeActor: vi.fn().mockResolvedValue({
      actor: 'u1',
      firstSeen: null,
      lastSeen: null,
      totalRecords: 0,
      tenantsTouched: [],
      byAction: [],
    }),
    stats: vi.fn().mockResolvedValue({ window: '30d', perDay: [], topActions: [], topActors: [], perTenant: [] }),
    countByDeclared: vi.fn().mockResolvedValue([]),
  };
  return { reader, svc: new AuditEventsApiService(reader, { isPlatformAdmin, catalog: [] }) };
}

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

const tenantAdmin: Actor = { id: 'a1', persona: 'compliance', tenantId: 't1' };
const platformAdmin: Actor = { id: 'p1', persona: 'platform', tenantId: null };

describe('AuditEventsApiService', () => {
  it('forces a non-platform actor to their own tenant, ignoring a tenantId param', async () => {
    const { svc, reader } = deps();
    await svc.find(tenantAdmin, { tenantId: 't2', actor: 'someone' });
    expect(reader.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', actor: 'someone' }));
  });

  it('lets a platform admin filter by any tenant, or null for platform-level rows', async () => {
    const { svc, reader } = deps();
    await svc.find(platformAdmin, { tenantId: 't9' });
    expect(reader.find).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9' }));

    await svc.find(platformAdmin, { tenantId: 'null' });
    expect(reader.find).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: null }));
  });

  it('lets a platform admin omit the tenant filter entirely', async () => {
    const { svc, reader } = deps();
    await svc.find(platformAdmin, {});
    const arg = (reader.find as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect('tenantId' in arg).toBe(false);
  });

  it('403s a non-platform actor that has no tenant (per a custom isPlatformAdmin)', async () => {
    const { svc } = deps(() => false); // nobody is a platform admin
    await expect(svc.find({ id: 'x', persona: 'p', tenantId: null }, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('parses occurredAfter/Before into Dates', async () => {
    const { svc, reader } = deps();
    await svc.find(platformAdmin, { occurredAfter: '2026-01-01T00:00:00Z' });
    expect(reader.find).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAfter: new Date('2026-01-01T00:00:00Z') }),
    );
  });

  it('entityHistory pins entityType + entityId', async () => {
    const { svc, reader } = deps();
    await svc.entityHistory(tenantAdmin, 'invoice', 'inv-1', {});
    expect(reader.find).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'invoice', entityId: 'inv-1', tenantId: 't1' }),
    );
  });

  it('trace pins correlationId', async () => {
    const { svc, reader } = deps();
    await svc.trace(platformAdmin, 'trace-xyz', {});
    expect(reader.find).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'trace-xyz' }));
  });
});

describe('AuditEventsApiService.findOne', () => {
  it('returns the record plus its computed diff when found', async () => {
    const { svc, reader } = deps();
    (reader.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(auditEvent());

    const detail = await svc.findOne(platformAdmin, 'ae-1');
    expect(detail).toMatchObject({ id: 'ae-1', diff: [{ field: 'status', before: 'sent', after: 'paid' }] });
  });

  it('forces a non-platform actor to their own tenant', async () => {
    const { svc, reader } = deps();
    await svc.findOne(tenantAdmin, 'ae-1').catch(() => {});
    expect(reader.findOne).toHaveBeenCalledWith('ae-1', 't1');
  });

  it('lets a platform admin fetch any record unscoped', async () => {
    const { svc, reader } = deps();
    (reader.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(auditEvent());
    await svc.findOne(platformAdmin, 'ae-1');
    expect(reader.findOne).toHaveBeenCalledWith('ae-1', undefined);
  });

  it('404s when the reader finds nothing — including a cross-tenant hit hidden by the reader', async () => {
    const { svc } = deps(); // reader.findOne defaults to resolving null
    await expect(svc.findOne(tenantAdmin, 'someone-elses-record')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403s a non-platform actor with no tenant', async () => {
    const { svc } = deps(() => false);
    await expect(svc.findOne({ id: 'x', persona: 'p', tenantId: null }, 'ae-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AuditEventsApiService.actorActivity', () => {
  it('scopes to the actor own tenant for a non-platform actor', async () => {
    const { svc, reader } = deps();
    await svc.actorActivity(tenantAdmin, 'u1', {});
    expect(reader.summarizeActor).toHaveBeenCalledWith('u1', expect.objectContaining({ tenantId: 't1' }));
  });

  it('leaves tenantId unset for a platform admin', async () => {
    const { svc, reader } = deps();
    await svc.actorActivity(platformAdmin, 'u1', {});
    const arg = (reader.summarizeActor as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect('tenantId' in arg).toBe(false);
  });

  it('parses occurredAfter/occurredBefore', async () => {
    const { svc, reader } = deps();
    await svc.actorActivity(platformAdmin, 'u1', { occurredAfter: '2026-06-01T00:00:00Z' });
    expect(reader.summarizeActor).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ occurredAfter: new Date('2026-06-01T00:00:00Z') }),
    );
  });
});

describe('AuditEventsApiService.stats', () => {
  it('forces a non-platform actor to their own tenant, ignoring a tenantId param', async () => {
    const { svc, reader } = deps();
    await svc.stats(tenantAdmin, { tenantId: 't9' });
    expect(reader.stats).toHaveBeenCalledWith('30d', 't1');
  });

  it('lets a platform admin filter by any tenant, or null, or omit it entirely', async () => {
    const { svc, reader } = deps();
    await svc.stats(platformAdmin, {});
    expect(reader.stats).toHaveBeenLastCalledWith('30d', undefined);

    await svc.stats(platformAdmin, { tenantId: 't2' });
    expect(reader.stats).toHaveBeenLastCalledWith('30d', 't2');

    await svc.stats(platformAdmin, { tenantId: 'null' });
    expect(reader.stats).toHaveBeenLastCalledWith('30d', null);
  });

  it('defaults window to 30d and passes through a supplied window', async () => {
    const { svc, reader } = deps();
    await svc.stats(platformAdmin, { window: '7d' });
    expect(reader.stats).toHaveBeenCalledWith('7d', undefined);
  });

  it('403s a non-platform actor with no tenant', async () => {
    const { svc } = deps(() => false);
    await expect(svc.stats({ id: 'x', persona: 'p', tenantId: null }, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AuditEventsApiService.coverage', () => {
  it('scopes counts to the actor own tenant for a non-platform actor', async () => {
    const { svc, reader } = deps();
    await svc.coverage(tenantAdmin, { entityTypes: ['invoice'], actions: [] });
    expect(reader.countByDeclared).toHaveBeenCalledWith({ entityTypes: ['invoice'], actions: [], tenantId: 't1' });
  });

  it('leaves tenantId unset (sees every tenant) for a platform admin', async () => {
    const { svc, reader } = deps();
    await svc.coverage(platformAdmin, { entityTypes: [], actions: ['payout.reversed'] });
    expect(reader.countByDeclared).toHaveBeenCalledWith({ entityTypes: [], actions: ['payout.reversed'] });
  });
});
