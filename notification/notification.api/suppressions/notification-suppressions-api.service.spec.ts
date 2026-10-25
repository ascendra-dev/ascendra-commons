import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvalidDeliveryCursorError, type NotificationConfigAdminPort, type SuppressionView } from '../../notification.core.database';
import { NotificationSuppressionsApiService } from './notification-suppressions-api.service';
import type { Actor } from '../../../authorization/authorization.core';

const entry = (tenantId: string | null): SuppressionView => ({
  id: '7', channel: 'email', recipientKey: 'h:abc', tenantId, reason: 'bounced', detail: '550 mailbox unavailable',
  firstAt: new Date(), lastAt: new Date(), eventCount: 2,
});
const tenantAdmin: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
const platform: Actor = { id: 'p', persona: 'platform', tenantId: null };

function deps() {
  const port = {
    listSuppressions: vi.fn().mockResolvedValue({ suppressions: [] }),
    getSuppression: vi.fn().mockResolvedValue(null),
    deleteSuppression: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationConfigAdminPort;
  const audit = { record: vi.fn() };
  return { port, audit, svc: new NotificationSuppressionsApiService(port, { isPlatformAdmin: (a) => a.tenantId === null }, audit) };
}

describe('NotificationSuppressionsApiService', () => {
  it("a tenant admin lists their own tenant's entries; a platform admin every one", async () => {
    const { svc, port } = deps();
    await svc.list(tenantAdmin, { limit: 20 });
    expect(port.listSuppressions).toHaveBeenLastCalledWith({ limit: 20, cursor: undefined }, { tenantId: 't1' });
    await svc.list(platform, {});
    expect(port.listSuppressions).toHaveBeenLastCalledWith({ limit: undefined, cursor: undefined }, undefined);
  });

  it('a cursor it never issued is a 400', async () => {
    const { svc, port } = deps();
    vi.mocked(port.listSuppressions).mockRejectedValueOnce(new InvalidDeliveryCursorError('x'));
    await expect(svc.list(platform, { cursor: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("removing one: another tenant's entry is the same 404 as a missing one", async () => {
    const { svc, port } = deps();
    await expect(svc.remove(tenantAdmin, '7')).rejects.toBeInstanceOf(NotFoundException);
    vi.mocked(port.getSuppression).mockResolvedValueOnce(entry('t2'));
    await expect(svc.remove(tenantAdmin, '7')).rejects.toBeInstanceOf(NotFoundException);
    vi.mocked(port.getSuppression).mockResolvedValueOnce(entry(null));
    await expect(svc.remove(tenantAdmin, '7')).rejects.toBeInstanceOf(NotFoundException);
    expect(port.deleteSuppression).not.toHaveBeenCalled();
  });

  it("removes and audits under the entry's tenant — the recipient is sent to again", async () => {
    const { svc, port, audit } = deps();
    vi.mocked(port.getSuppression).mockResolvedValueOnce(entry('t1'));
    await svc.remove(tenantAdmin, '7');
    expect(port.deleteSuppression).toHaveBeenCalledWith('7');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.suppression_removed', tenantId: 't1', entityId: 'email:h:abc' }),
    );
  });
});
