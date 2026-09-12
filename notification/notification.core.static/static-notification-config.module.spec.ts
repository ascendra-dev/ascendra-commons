import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotificationModule, Notifier, NOTIFIER } from '../notification.core';
import { StaticNotificationConfigModule } from './static-notification-config.module';
import { STATIC_NOTIFICATION_CONFIG } from './tokens';

const STATIC_CONFIG = {
  channels: {
    'invoice.sent': ['email' as const],
    'payment.confirmed': ['email' as const, 'sms' as const],
    'payment.overdue.reminder': ['email' as const, 'sms' as const],
  },
  templates: {
    email: {
      'invoice.sent': { subject: 'Invoice {{invoiceNumber}}', body: 'Hi' },
      'payment.confirmed': { subject: 'Payment received', body: 'Thanks' },
    },
    sms: {
      'payment.confirmed': { body: 'Payment of {{amount}} received' },
      'payment.overdue.reminder': { body: 'Pay {{amount}}' },
    },
  },
  providerConfigs: {
    email: { 'tenant-1': { apiKey: 'e', from: 'billing@example.com' } },
    sms: { 'tenant-1': { apiKey: 's', from: '+10000000000' } },
  },
};

function build(cfg = STATIC_CONFIG) {
  return Test.createTestingModule({
    imports: [
      NotificationModule.forRoot({
        configToken: STATIC_NOTIFICATION_CONFIG,
        imports: [StaticNotificationConfigModule.forRoot(cfg)],
      }),
    ],
  }).compile();
}

describe('StaticNotificationConfigModule wired through NotificationModule — real DI, end to end', () => {
  it('throws without channels', () => {
    // @ts-expect-error — deliberately omitting the required field
    expect(() => StaticNotificationConfigModule.forRoot({ templates: {} })).toThrow(/requires 'channels'/);
  });

  it('delivers through a single real channel end to end', async () => {
    const notifier = (await build()).get<Notifier>(NOTIFIER);
    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
      tenantId: 'tenant-1',
    });
    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it('delivers through email + sms, each using its own channel template', async () => {
    const notifier = (await build()).get<Notifier>(NOTIFIER);
    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com', phone: '+923001234567' },
      notificationType: 'payment.confirmed',
      variables: { amount: 1500 },
      tenantId: 'tenant-1',
    });
    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' }, sms: { status: 'sent' } } });
  });

  it('fails closed for a notificationType with no channel configured', async () => {
    const notifier = (await build()).get<Notifier>(NOTIFIER);
    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'unconfigured.type',
      variables: {},
    });
    expect(result).toEqual({ status: 'failed', reason: 'no_channel_configured', channels: {} });
  });

  it('fails per-channel when a channel is configured but its template is missing', async () => {
    const notifier = (await build()).get<Notifier>(NOTIFIER);
    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com', phone: '+923001234567' },
      notificationType: 'payment.overdue.reminder',
      variables: { amount: 1500 },
      tenantId: 'tenant-1',
    });
    expect(result.status).toBe('partial');
    expect(result.channels?.email).toEqual({ status: 'failed', reason: 'template_not_found' });
    expect(result.channels?.sms).toEqual({ status: 'sent' });
  });

  it('the default NullUserContactResolver fails a user recipient closed', async () => {
    const notifier = (await build()).get<Notifier>(NOTIFIER);
    const result = await notifier.notify({
      recipient: { type: 'user', id: 'issuer-1' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
    });
    expect(result).toEqual({
      status: 'failed',
      channels: { email: { status: 'failed', reason: 'no_address_available' } },
    });
  });

  it('templates and providerConfigs are optional — a channels-only config wires fine', async () => {
    const notifier = (await build({ channels: { 'invoice.sent': ['email'] } } as typeof STATIC_CONFIG)).get<Notifier>(
      NOTIFIER,
    );
    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'p@e.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 'tenant-1',
    });
    expect(result.channels?.email).toEqual({ status: 'failed', reason: 'no_provider_config' });
  });
});
