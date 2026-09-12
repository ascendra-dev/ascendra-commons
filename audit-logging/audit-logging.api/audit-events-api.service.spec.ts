import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AuditEventsApiService } from './audit-events-api.service';
import type { AuditEventReader } from '../audit-logging.core';
import type { AuditApiOptions } from './audit-api.options';
import type { Actor } from '../../authorization/authorization.core';

function deps(isPlatformAdmin: AuditApiOptions['isPlatformAdmin'] = (a) => a.tenantId === null) {
  const reader: AuditEventReader = { find: vi.fn().mockResolvedValue({ records: [] }) };
  return { reader, svc: new AuditEventsApiService(reader, { isPlatformAdmin }) };
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
