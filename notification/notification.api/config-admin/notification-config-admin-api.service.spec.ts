import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationConfigAdminApiService } from './notification-config-admin-api.service';
import type { NotificationConfigAdminPort } from '../../notification.core.database';
import type { NotificationApiOptions } from '../notification-api.options';
import type { NotificationAuditEmitter } from '../notification-audit.port';
import type { Actor } from '../../../authorization/authorization.core';

function deps(isPlatformAdmin: NotificationApiOptions['isPlatformAdmin'] = (a) => a.tenantId === null) {
  const port: NotificationConfigAdminPort = {
    getChannelRoute: vi.fn().mockResolvedValue(null),
    getTemplate: vi.fn().mockResolvedValue(null),
    hasProviderCredential: vi.fn().mockResolvedValue(false),
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

  it("list reads: a tenant admin gets the defaults plus their own tenant — never another tenant's config", async () => {
    const { svc, port } = deps();
    await svc.listChannelRoutes(tenantAdmin);
    await svc.listTemplates(tenantAdmin);
    await svc.listProviderCredentials(tenantAdmin);
    expect(port.listChannelRoutes).toHaveBeenCalledWith({ tenantId: 't1' });
    expect(port.listTemplates).toHaveBeenCalledWith({ tenantId: 't1' });
    expect(port.listProviderCredentials).toHaveBeenCalledWith({ tenantId: 't1' });
  });

  it('list reads: a platform admin sees every row', async () => {
    const { svc, port } = deps();
    await svc.listChannelRoutes(platformAdmin);
    await svc.listTemplates(platformAdmin);
    await svc.listProviderCredentials(platformAdmin);
    expect(port.listChannelRoutes).toHaveBeenCalledWith(undefined);
    expect(port.listTemplates).toHaveBeenCalledWith(undefined);
    expect(port.listProviderCredentials).toHaveBeenCalledWith(undefined);
  });
});

describe('NotificationConfigAdminApiService — validation: a 400, never a 500', () => {
  it.each([
    ['channels not an array', { notificationType: 'x', tenantId: null, channels: 'email' }],
    ['no channels', { notificationType: 'x', tenantId: null, channels: [] }],
    ['an unknown channel', { notificationType: 'x', tenantId: null, channels: ['fax'] }],
    ['no notificationType', { tenantId: null, channels: ['email'] }],
    ['tenantId absent — say null for the default', { notificationType: 'x', channels: ['email'] }],
  ])('route: %s', async (_label, body) => {
    const { svc, port } = deps();
    await expect(svc.setChannelRoute(platformAdmin, body as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(port.setChannelRoute).not.toHaveBeenCalled();
  });

  it('route: duplicate channels collapse', async () => {
    const { svc, port } = deps();
    await svc.setChannelRoute(platformAdmin, { notificationType: 'x', tenantId: null, channels: ['email', 'email', 'sms'] });
    expect(port.setChannelRoute).toHaveBeenCalledWith({ notificationType: 'x', tenantId: null, channels: ['email', 'sms'] });
  });

  it.each([
    ['an unknown channel', { channel: 'fax', notificationType: 'x', tenantId: null, body: 'b' }],
    ['no body', { channel: 'email', notificationType: 'x', tenantId: null }],
    ['a subject on SMS', { channel: 'sms', notificationType: 'x', tenantId: null, subject: 'Hi', body: 'b' }],
    ['isHtml on SMS', { channel: 'sms', notificationType: 'x', tenantId: null, isHtml: true, body: 'b' }],
    ['isHtml not a boolean', { channel: 'email', notificationType: 'x', tenantId: null, isHtml: 'yes', body: 'b' }],
    ['a NUL in the body', { channel: 'email', notificationType: 'x', tenantId: null, body: 'a\u0000b' }],
  ])('template: %s', async (_label, body) => {
    const { svc } = deps();
    await expect(svc.setTemplate(platformAdmin, body as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['config not an object', { channel: 'email', tenantId: 't1', config: 'key' }],
    ['config an array', { channel: 'email', tenantId: 't1', config: ['k'] }],
    ['no tenant', { channel: 'email', config: { k: 1 } }],
    ['config too large', { channel: 'email', tenantId: 't1', config: { k: 'x'.repeat(20_000) } }],
  ])('credential: %s', async (_label, body) => {
    const { svc } = deps();
    await expect(svc.setProviderCredential(platformAdmin, body as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preview: variables must be strings or numbers', () => {
    const { svc } = deps();
    expect(() => svc.previewTemplate({ body: 'b', variables: { a: { nested: 1 } } as never })).toThrow(BadRequestException);
  });
});

describe('NotificationConfigAdminApiService — deletes', () => {
  it('a row that is not there is a 404 — nothing deleted, nothing audited', async () => {
    const { svc, port, audit } = deps();
    await expect(svc.deleteChannelRoute(platformAdmin, 'x', undefined)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteTemplate(platformAdmin, 'email', 'x', 't1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteProviderCredential(platformAdmin, 'email', 't1')).rejects.toBeInstanceOf(NotFoundException);
    expect(port.deleteChannelRoute).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('an absent tenantId names the default row — a tenant admin may not delete it', async () => {
    const { svc } = deps();
    await expect(svc.deleteChannelRoute(tenantAdmin, 'x', undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("an absent tenantId names the platform's credential — a tenant admin may not touch it", async () => {
    const { svc, port } = deps();
    await expect(svc.deleteProviderCredential(tenantAdmin, 'email', undefined)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.setProviderCredential(tenantAdmin, { channel: 'email', tenantId: null, config: { k: 1 } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await svc.setProviderCredential(platformAdmin, { channel: 'email', tenantId: null, config: { k: 1 } });
    expect(port.setProviderCredential).toHaveBeenCalledWith({ channel: 'email', tenantId: null, config: { k: 1 } });
  });

  it('deletes and audits what was there', async () => {
    const { svc, port, audit } = deps();
    const row = { notificationType: 'x', tenantId: 't1', channels: ['email' as const] };
    vi.mocked(port.getChannelRoute).mockResolvedValueOnce(row);
    await svc.deleteChannelRoute(tenantAdmin, 'x', 't1');
    expect(port.deleteChannelRoute).toHaveBeenCalledWith({ notificationType: 'x', tenantId: 't1' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification.route_deleted', before: row, tenantId: 't1' }));
  });
});

describe('NotificationConfigAdminApiService — audit', () => {
  it("an edit carries before and after, filed under the row's tenant — not the platform admin's", async () => {
    const { svc, port, audit } = deps();
    const before = { channel: 'email' as const, notificationType: 'x', tenantId: 't1', subject: 'Old', body: 'old', isHtml: false };
    vi.mocked(port.getTemplate).mockResolvedValueOnce(before);
    await svc.setTemplate(platformAdmin, { channel: 'email', notificationType: 'x', tenantId: 't1', subject: 'New', body: 'new' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'notification.template_set',
        actorId: 'p-1',
        tenantId: 't1',
        before,
        after: expect.objectContaining({ subject: 'New', body: 'new' }),
      }),
    );
  });

  it('a credential replace says one was there — the value never appears', async () => {
    const { svc, port, audit } = deps();
    vi.mocked(port.hasProviderCredential).mockResolvedValueOnce(true);
    await svc.setProviderCredential(platformAdmin, { channel: 'email', tenantId: 't1', config: { apiKey: 'secret' } });
    const event = vi.mocked(audit.record).mock.calls[0][0];
    expect(event).toMatchObject({ tenantId: 't1', before: { present: true }, after: { present: true } });
    expect(JSON.stringify(event)).not.toContain('secret');
  });
});

describe('NotificationConfigAdminApiService — previewTemplate', () => {
  it('renders the candidate template against the given variables without touching the port', async () => {
    const { svc, port } = deps();
    const result = svc.previewTemplate({ subject: 'Invoice {{n}}', body: 'Amount: {{amount}}', isHtml: true, variables: { n: 'INV-1', amount: 40 } });
    expect(result).toEqual({ subject: 'Invoice INV-1', body: 'Amount: 40', isHtml: true });
    expect(port.setTemplate).not.toHaveBeenCalled();
  });

  it('defaults variables to empty and leaves unresolved placeholders visible', () => {
    const { svc } = deps();
    const result = svc.previewTemplate({ body: 'Hi {{name}}' });
    expect(result.body).toBe('Hi {{name}}');
    expect(result.subject).toBeUndefined();
  });
});
