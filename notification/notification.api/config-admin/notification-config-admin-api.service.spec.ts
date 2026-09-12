import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { NotificationConfigAdminApiService } from './notification-config-admin-api.service';
import type { NotificationConfigAdminPort } from '../../notification.core.database';
import type { NotificationApiOptions } from '../notification-api.options';
import type { NotificationAuditEmitter } from '../notification-audit.port';
import type { Actor } from '../../../authorization/authorization.core';

function deps(isPlatformAdmin: NotificationApiOptions['isPlatformAdmin'] = (a) => a.tenantId === null) {
  const port: NotificationConfigAdminPort = {
    setChannelRoute: vi.fn().mockResolvedValue(undefined),
    deleteChannelRoute: vi.fn().mockResolvedValue(undefined),
    listChannelRoutes: vi.fn().mockResolvedValue([]),
    setTemplate: vi.fn().mockResolvedValue(undefined),
    deleteTemplate: vi.fn().mockResolvedValue(undefined),
    listTemplates: vi.fn().mockResolvedValue([]),
    setProviderCredential: vi.fn().mockResolvedValue(undefined),
    deleteProviderCredential: vi.fn().mockResolvedValue(undefined),
    listProviderCredentials: vi.fn().mockResolvedValue([]),
  };
  const audit: NotificationAuditEmitter = { record: vi.fn() };
  return { port, audit, svc: new NotificationConfigAdminApiService(port, { isPlatformAdmin }, audit) };
}

const tenantAdmin: Actor = { id: 'admin-1', persona: 'issuer_admin', tenantId: 't1' };
const platformAdmin: Actor = { id: 'p-1', persona: 'platform', tenantId: null };

describe('NotificationConfigAdminApiService — tenant ceiling', () => {
  it('lets a tenant admin write their own tenant row and audits it', async () => {
    const { svc, port, audit } = deps();
    await svc.setChannelRoute(tenantAdmin, { notificationType: 'invoice.sent', tenantId: 't1', channels: ['email'] });
    expect(port.setChannelRoute).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.route_set', actorId: 'admin-1', entityType: 'channel_route' }),
    );
  });

  it('rejects a tenant admin editing the deployment default (null tenant)', async () => {
    const { svc, port } = deps();
    await expect(
      svc.setTemplate(tenantAdmin, { channel: 'email', notificationType: 'x', tenantId: null, body: 'b' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(port.setTemplate).not.toHaveBeenCalled();
  });

  it('rejects a tenant admin editing another tenant', async () => {
    const { svc } = deps();
    await expect(
      svc.setProviderCredential(tenantAdmin, { channel: 'email', tenantId: 't2', config: { k: 1 } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a platform admin edit the deployment default and any tenant', async () => {
    const { svc, port } = deps();
    await svc.setChannelRoute(platformAdmin, { notificationType: 'x', tenantId: null, channels: ['email'] });
    await svc.setChannelRoute(platformAdmin, { notificationType: 'x', tenantId: 't9', channels: ['sms'] });
    expect(port.setChannelRoute).toHaveBeenCalledTimes(2);
  });

  it('never puts the credential value in the audit event', async () => {
    const { svc, audit } = deps();
    await svc.setProviderCredential(platformAdmin, { channel: 'email', tenantId: 't1', config: { apiKey: 'secret' } });
    const event = (audit.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.stringify(event)).not.toContain('secret');
  });

  it('list reads are unscoped', async () => {
    const { svc, port } = deps();
    await svc.listChannelRoutes();
    await svc.listProviderCredentials();
    expect(port.listChannelRoutes).toHaveBeenCalled();
    expect(port.listProviderCredentials).toHaveBeenCalled();
  });
});
