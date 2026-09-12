import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NotificationTestSendApiService } from './notification-test-send-api.service';
import type { Notifier } from '../../notification.core';
import type { Actor } from '../../../authorization/authorization.core';

function deps(isPlatformAdmin: (a: Actor) => boolean = (a) => a.tenantId === null) {
  const notifier = { notify: vi.fn().mockResolvedValue({ status: 'sent', channels: { email: { status: 'sent' } } }) } as unknown as Notifier;
  return { notifier, svc: new NotificationTestSendApiService(notifier, { isPlatformAdmin }) };
}

const actor: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };

describe('NotificationTestSendApiService', () => {
  it('sends with the actor tenant', async () => {
    const { svc, notifier } = deps();
    await svc.send(actor, { recipient: { type: 'raw', email: 'p@e.com' }, notificationType: 'invoice.sent' });
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', notificationType: 'invoice.sent' }));
  });

  it('rejects a missing recipient / notificationType', async () => {
    const { svc } = deps();
    // @ts-expect-error — deliberately incomplete body
    await expect(svc.send(actor, { notificationType: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-platform actor targeting another tenant', async () => {
    const { svc } = deps();
    await expect(
      svc.send(actor, { recipient: { type: 'raw', email: 'p@e.com' }, notificationType: 'x', tenantId: 't2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a platform admin target another tenant', async () => {
    const { svc, notifier } = deps();
    const platform: Actor = { id: 'p', persona: 'platform', tenantId: null };
    await svc.send(platform, { recipient: { type: 'raw', email: 'p@e.com' }, notificationType: 'x', tenantId: 't9' });
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9' }));
  });
});
