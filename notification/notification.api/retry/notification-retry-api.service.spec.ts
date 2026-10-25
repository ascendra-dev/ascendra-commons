import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationRetryApiService } from './notification-retry-api.service';
import type { Notifier } from '../../notification.core';
import type { DeliveryRecord, NotificationObservabilityPort } from '../../notification.core.database';
import type { Actor } from '../../../authorization/authorization.core';

const failed = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  id: '41', notificationType: 'invoice.sent', channel: 'sms', tenantId: 't1', recipientRef: 'user:u9', recipientKey: 'user:u9',
  status: 'failed', reason: 'provider_timeout', providerMessageId: null, attemptedAt: new Date(), updatedAt: new Date(),
  correlationId: 'corr-1', hasContent: true, isTest: false, retryOf: null, retriedBy: null, ...over,
});
const stored = { id: '41', notificationType: 'invoice.sent', channel: 'sms' as const, recipientRef: 'user:u9', attemptedAt: new Date(), content: { subject: null, body: 'b', isHtml: false, variables: { amount: '40' } } };
const tenantAdmin: Actor = { id: 'a1', persona: 'admin', tenantId: 't1' };

function deps(delivery: DeliveryRecord | null, content: unknown = stored) {
  const port = { getDelivery: vi.fn().mockResolvedValue(delivery), getDeliveryContent: vi.fn().mockResolvedValue(content) } as unknown as NotificationObservabilityPort;
  const notifier = { flushDeliveryLog: vi.fn().mockResolvedValue(undefined), notify: vi.fn().mockResolvedValue({ status: 'sent', channels: { sms: { status: 'sent' } } }) } as unknown as Notifier;
  const audit = { record: vi.fn() };
  return { notifier, audit, svc: new NotificationRetryApiService(port, notifier, { isPlatformAdmin: (a) => a.tenantId === null }, audit) };
}

describe('NotificationRetryApiService', () => {
  it('resends on its channel only, to the user, with the stored variables — linked and audited', async () => {
    const { svc, notifier, audit } = deps(failed());
    await expect(svc.retry(tenantAdmin, '41')).resolves.toMatchObject({ status: 'sent' });
    expect(notifier.notify).toHaveBeenCalledWith({
      recipient: { type: 'user', id: 'u9' }, notificationType: 'invoice.sent', variables: { amount: '40' },
      tenantId: 't1', channels: ['sms'], retryOf: '41', correlationId: 'corr-1',
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification.delivery_retried', entityId: '41', tenantId: 't1' }));
    // The retry's row is written before the answer — the retried row names it at once.
    expect(notifier.flushDeliveryLog).toHaveBeenCalledTimes(1);
  });

  it("another tenant's delivery is the same 404 as a missing one", async () => {
    await expect(deps(failed({ tenantId: 't2' })).svc.retry(tenantAdmin, '41')).rejects.toBeInstanceOf(NotFoundException);
    await expect(deps(null).svc.retry(tenantAdmin, '41')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['a delivery that went out', failed({ status: 'sent' }), stored, /only a failed or bounced/],
    ['one already retried', failed({ retriedBy: '57' }), stored, /already retried — delivery 57/],
    ['a test send', failed({ isTest: true }), stored, /test send/],
    ['a guest — no address stored', failed({ recipientRef: 'raw:email' }), stored, /guest/],
    ['no stored variables', failed(), null, /storeContent/],
  ])('not %s — a 400 that says why', async (_label, delivery, content, message) => {
    const { svc, notifier } = deps(delivery, content);
    await expect(svc.retry(tenantAdmin, '41')).rejects.toThrow(message);
    await expect(svc.retry(tenantAdmin, '41')).rejects.toBeInstanceOf(BadRequestException);
    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
