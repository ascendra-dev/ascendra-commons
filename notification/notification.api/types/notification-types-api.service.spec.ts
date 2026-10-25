import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationTypeCatalog } from './notification-type-catalog';
import { NotificationTypesApiService } from './notification-types-api.service';
import type { NotificationConfigAdminPort, NotificationObservabilityPort } from '../../notification.core.database';
import type { NotificationTypeDefinition } from '../../notification.core';
import type { Actor } from '../../../authorization/authorization.core';

const INVOICE_SENT: NotificationTypeDefinition = {
  name: 'invoice.sent',
  description: 'The payer is told their invoice is ready',
  audience: 'payer',
  variables: [
    { name: 'invoiceNumber', sample: 'INV-0042' },
    { name: 'amount', sample: '4,820.00' },
  ],
};
const tenantAdmin: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
const platform: Actor = { id: 'p', persona: 'platform', tenantId: null };

function service(types: NotificationTypeDefinition[] = [INVOICE_SENT]) {
  const config = {
    listChannelRoutes: vi.fn().mockResolvedValue([
      { notificationType: 'invoice.sent', tenantId: null, channels: ['email'] },
      { notificationType: 'invoice.sent', tenantId: 't1', channels: ['email', 'sms'] },
      { notificationType: 'invoice.sentt', tenantId: null, channels: ['sms'] },
    ]),
    listTemplates: vi.fn().mockResolvedValue([
      { channel: 'email', notificationType: 'invoice.sent', tenantId: null, subject: 'S', body: 'B', isHtml: false },
    ]),
  } as unknown as NotificationConfigAdminPort;
  const observability = {
    configCoverageGaps: vi.fn().mockResolvedValue([{ notificationType: 'invoice.sent', tenantId: 't1', channel: 'sms', kind: 'missing_template' }]),
  } as unknown as NotificationObservabilityPort;
  const svc = new NotificationTypesApiService(config, observability, { isPlatformAdmin: (a) => a.tenantId === null }, new NotificationTypeCatalog(types));
  return { svc, config, observability };
}

describe('NotificationTypesApiService', () => {
  it('lists the declared types joined with their config — and a configured type nobody declared', async () => {
    const { svc } = service();
    const list = await svc.list(platform);
    expect(list).toEqual([
      {
        name: 'invoice.sent', declared: true, description: 'The payer is told their invoice is ready', audience: 'payer',
        variables: INVOICE_SENT.variables, defaultChannels: ['email'], tenantRoutes: 1,
        templates: [{ channel: 'email', tenantId: null }], gaps: 1,
      },
      {
        name: 'invoice.sentt', declared: false, description: null, audience: null, variables: [],
        defaultChannels: ['sms'], tenantRoutes: 0, templates: [], gaps: 0,
      },
    ]);
  });

  it('is scoped like the config reads — a tenant admin reads the defaults plus their own tenant', async () => {
    const { svc, config, observability } = service();
    await svc.list(tenantAdmin);
    expect(config.listChannelRoutes).toHaveBeenCalledWith({ tenantId: 't1' });
    expect(config.listTemplates).toHaveBeenCalledWith({ tenantId: 't1' });
    expect(observability.configCoverageGaps).toHaveBeenCalledWith({ tenantId: 't1' }, undefined);
  });

  it("a type's page: its definition, routes, templates and gaps", async () => {
    const { svc } = service();
    const detail = await svc.detail(platform, 'invoice.sent');
    expect(detail).toMatchObject({ name: 'invoice.sent', declared: true, defaultChannels: ['email'] });
    expect(detail.routes).toHaveLength(2);
    expect(detail.templates).toHaveLength(1);
    expect(detail.gaps).toHaveLength(1);
  });

  it('a type neither declared nor configured is a 404; a bad name a 400', async () => {
    const { svc } = service();
    await expect(svc.detail(platform, 'payout.sent')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.detail(platform, 'a\u0000b')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('NotificationTypeCatalog', () => {
  const catalog = new NotificationTypeCatalog([INVOICE_SENT]);

  it("a type the app doesn't declare is a 400 — once it declares any", () => {
    expect(() => catalog.assertKnown('invoice.sentt')).toThrow(BadRequestException);
    expect(() => catalog.assertKnown('invoice.sent')).not.toThrow();
    expect(() => new NotificationTypeCatalog([]).assertKnown('anything')).not.toThrow();
  });

  it('a template using a variable the type lacks is a 400 naming what it has', () => {
    expect(() => catalog.assertVariables('invoice.sent', 'Invoice {{invoiceNo}}', 'Pay {{amount}}')).toThrow(
      /\{\{invoiceNo\}\} is not a variable of "invoice.sent" — it has \{\{invoiceNumber\}\}, \{\{amount\}\}/,
    );
    expect(() => catalog.assertVariables('invoice.sent', 'Invoice {{invoiceNumber}}', 'Pay {{amount}}')).not.toThrow();
  });

  it("samples fill what's left out", () => {
    expect(catalog.withSamples('invoice.sent', { amount: '10.00' })).toEqual({ invoiceNumber: 'INV-0042', amount: '10.00' });
    expect(catalog.withSamples(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});
