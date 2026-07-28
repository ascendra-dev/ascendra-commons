import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotificationModule } from './notification.module';
import { Notifier } from './notifier';
import { NOTIFIER } from './tokens';

/**
 * Real NestJS DI, not manually constructed classes — this is the only place
 * that would catch a missing binding, a useFactory inject list out of order,
 * or a useExisting mismatch. Every unit test above uses hand-built fakes and
 * would happily pass even if the actual module wiring were broken.
 */
async function buildTestModule() {
  return Test.createTestingModule({
    imports: [
      NotificationModule.forRoot({
        channels: {
          'invoice.sent': ['email'],
          'payment.confirmed': ['email', 'sms'],
          // Deliberately missing from emailTemplates below, so this notificationType
          // proves the per-channel-template-missing case.
          'payment.overdue.reminder': ['email', 'sms'],
        },
        emailTemplates: {
          'invoice.sent': { subject: 'Invoice {{invoiceNumber}}', body: 'Hi' },
          'payment.confirmed': { subject: 'Payment received', body: 'Thanks' },
        },
        smsTemplates: {
          'payment.confirmed': { body: 'Payment of {{amount}} received' },
          'payment.overdue.reminder': { body: 'Pay {{amount}}' },
        },
      }),
    ],
  }).compile();
}

describe('NotificationModule.forRoot — real DI wiring', () => {
  it('resolves NOTIFIER to the same instance as Notifier', async () => {
    const moduleRef = await buildTestModule();

    expect(moduleRef.get(NOTIFIER)).toBe(moduleRef.get(Notifier));
  });

  it('delivers through a single real channel end to end', async () => {
    const moduleRef = await buildTestModule();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it('delivers through two real channels (email + sms) end to end, using each channel’s own templates', async () => {
    const moduleRef = await buildTestModule();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com', phone: '+923001234567' },
      notificationType: 'payment.confirmed',
      variables: { amount: 1500 },
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' }, sms: { status: 'sent' } } });
  });

  it('fails closed for a notificationType nobody configured a channel for', async () => {
    const moduleRef = await buildTestModule();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'unconfigured.type',
      variables: {},
    });

    expect(result).toEqual({ status: 'failed', reason: 'no_channel_configured', channels: {} });
  });

  it('fails per-channel when a channel is configured but its template is missing', async () => {
    const moduleRef = await buildTestModule();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    // 'email' is configured for payment.overdue.reminder, but emailTemplates
    // above has no entry for it — only smsTemplates does.
    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com', phone: '+923001234567' },
      notificationType: 'payment.overdue.reminder',
      variables: { amount: 1500 },
    });

    // email has no template for this notificationType, sms does — so the
    // honest aggregate is 'partial', not 'sent'.
    expect(result.status).toBe('partial');
    expect(result.channels?.email).toEqual({ status: 'failed', reason: 'template_not_found' });
    expect(result.channels?.sms).toEqual({ status: 'sent' });
  });
});
