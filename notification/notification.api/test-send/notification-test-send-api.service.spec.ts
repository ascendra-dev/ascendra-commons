import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NotificationTestSendApiService } from './notification-test-send-api.service';
import type { Notifier, UserContactResolver } from '../../notification.core';
import type { Actor } from '../../../authorization/authorization.core';
import { NotificationTypeCatalog } from '../types/notification-type-catalog';

function deps(users?: UserContactResolver, types = new NotificationTypeCatalog()) {
  const notifier = { notify: vi.fn().mockResolvedValue({ status: 'sent', channels: { email: { status: 'sent' } } }) } as unknown as Notifier;
  const svc = new NotificationTestSendApiService(notifier, { isPlatformAdmin: (a) => a.tenantId === null }, users, types);
  return { notifier, svc };
}
const resolver = (byId: Record<string, { tenantId?: string | null }>): UserContactResolver => ({
  findById: vi.fn(async (id: string) => (byId[id] ? { email: `${id}@x.test`, ...byId[id] } : null)),
});

const tenantAdmin: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
const platform: Actor = { id: 'p', persona: 'platform', tenantId: null };
const self = { type: 'user' as const, id: 'u1' };

describe('NotificationTestSendApiService', () => {
  it("sends with the actor's tenant, marked as a test", async () => {
    const { svc, notifier } = deps();
    await svc.send(tenantAdmin, { recipient: self, notificationType: 'invoice.sent' });
    expect(notifier.notify).toHaveBeenCalledWith({
      recipient: self, notificationType: 'invoice.sent', variables: {}, tenantId: 't1', test: true,
    });
  });

  it.each([
    ['no recipient', { notificationType: 'x' }],
    ['no notificationType', { recipient: self }],
    ['an unknown recipient type', { recipient: { type: 'group', id: 'g' }, notificationType: 'x' }],
    ['a raw recipient with no address', { recipient: { type: 'raw' }, notificationType: 'x' }],
    ['nested variables', { recipient: self, notificationType: 'x', variables: { a: [1] } }],
  ])('%s is a 400', async (_label, body) => {
    const { svc } = deps();
    await expect(svc.send(tenantAdmin, body as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a tenant admin may not test another tenant's configuration", async () => {
    const { svc } = deps();
    await expect(svc.send(tenantAdmin, { recipient: self, notificationType: 'x', tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a tenant admin may not send to a raw address — a phishing tool on their domain', async () => {
    const { svc, notifier } = deps();
    await expect(
      svc.send(tenantAdmin, { recipient: { type: 'raw', email: 'anyone@example.com' }, notificationType: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('a tenant admin may send to a colleague the resolver places in their tenant', async () => {
    const { svc, notifier } = deps(resolver({ u2: { tenantId: 't1' } }));
    await svc.send(tenantAdmin, { recipient: { type: 'user', id: 'u2' }, notificationType: 'x' });
    expect(notifier.notify).toHaveBeenCalled();
  });

  it.each([
    ['in another tenant', resolver({ u2: { tenantId: 't2' } })],
    ['unknown to the resolver', resolver({})],
    ['whose tenant the resolver does not report', resolver({ u2: {} })],
    ['with no resolver bound', undefined],
  ])('not to a user %s', async (_label, users) => {
    const { svc } = deps(users);
    await expect(svc.send(tenantAdmin, { recipient: { type: 'user', id: 'u2' }, notificationType: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a platform admin may send to an address, against any tenant', async () => {
    const { svc, notifier } = deps();
    await svc.send(platform, { recipient: { type: 'raw', email: 'ops@example.com' }, notificationType: 'x', tenantId: 't9' });
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9', test: true }));
  });

  it("a declared type's samples fill the variables the caller leaves out; an undeclared type is a 400", async () => {
    const types = new NotificationTypeCatalog([{ name: 'invoice.sent', variables: [{ name: 'amount', sample: '9.99' }, { name: 'n', sample: 'INV-1' }] }]);
    const { svc, notifier } = deps(undefined, types);
    await svc.send(tenantAdmin, { recipient: self, notificationType: 'invoice.sent', variables: { n: 'INV-7' } });
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ variables: { amount: '9.99', n: 'INV-7' } }));
    await expect(svc.send(tenantAdmin, { recipient: self, notificationType: 'invoice.sentt' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
