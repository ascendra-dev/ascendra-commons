import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationModule } from './notification.module';
import { Notifier } from './notifier';
import { NotificationConfig, StaticNotificationConfig } from './notification-config';
import { UserContactResolver } from './user-contact-resolver';
import { NOTIFIER, USER_CONTACT_RESOLVER } from './tokens';

/**
 * Real NestJS DI — the only place that catches a missing binding, a useFactory
 * inject list out of order, or a useExisting mismatch. Every unit test above
 * uses hand-built fakes and would pass even if the module wiring were broken.
 */
const STATIC_CONFIG = {
  channels: {
    'invoice.sent': ['email' as const],
    'payment.confirmed': ['email' as const, 'sms' as const],
    // 'email' is configured but has no email template below — proves the per-channel missing-template case.
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

function buildTestModule() {
  return Test.createTestingModule({
    imports: [NotificationModule.forRoot(STATIC_CONFIG)],
  }).compile();
}

describe('NotificationModule.forRoot — real DI wiring', () => {
  it('resolves NOTIFIER to the same instance as Notifier', async () => {
    const moduleRef = await buildTestModule();
    expect(moduleRef.get(NOTIFIER)).toBe(moduleRef.get(Notifier));
  });

  it('delivers through a single real channel end to end', async () => {
    const notifier = (await buildTestModule()).get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it('delivers through email + sms end to end, each using its own channel template', async () => {
    const notifier = (await buildTestModule()).get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com', phone: '+923001234567' },
      notificationType: 'payment.confirmed',
      variables: { amount: 1500 },
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' }, sms: { status: 'sent' } } });
  });

  it('fails closed for a notificationType with no channel configured', async () => {
    const notifier = (await buildTestModule()).get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'unconfigured.type',
      variables: {},
    });

    expect(result).toEqual({ status: 'failed', reason: 'no_channel_configured', channels: {} });
  });

  it('fails per-channel when a channel is configured but its template is missing', async () => {
    const notifier = (await buildTestModule()).get<Notifier>(NOTIFIER);

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
    const notifier = (await buildTestModule()).get<Notifier>(NOTIFIER);

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

  it("model defaults to 'static' and requires 'channels'", () => {
    expect(() => NotificationModule.forRoot({ templates: {} })).toThrow(/requires 'channels'/);
  });

  it("model: 'database' requires 'configToken'", () => {
    expect(() => NotificationModule.forRoot({ model: 'database' })).toThrow(/requires 'configToken'/);
  });

  it('templates and providerConfigs are optional — a channels-only config wires fine', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ channels: { 'invoice.sent': ['email'] } })],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'p@e.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 'tenant-1',
    });

    // no provider config for the tenant → graceful per-send failure, not a wiring error
    expect(result.channels?.email).toEqual({ status: 'failed', reason: 'no_provider_config' });
  });
});

const DB_CONFIG_TOKEN = Symbol('DB_CONFIG_TOKEN');
const USER_RESOLVER_TOKEN = Symbol('USER_RESOLVER_TOKEN');

/**
 * Stands in for a consuming project's own providers module — the real
 * production path (`imports` + a `*Token` field), not `.overrideProvider()`.
 * `Notifier` is constructed inside NotificationModule's own DI scope, so a
 * token re-declared in an unrelated module can't reach it — this proves the
 * seam works outside a test.
 */
@Module({
  providers: [
    {
      provide: DB_CONFIG_TOKEN,
      useValue: {
        channelsFor: vi.fn().mockResolvedValue(['email']),
        templateFor: vi.fn().mockResolvedValue({ subject: 'DB', body: 'DB body' }),
        providerConfigFor: vi.fn().mockResolvedValue({ apiKey: 'k', from: 'db@example.com' }),
      } satisfies NotificationConfig,
    },
    {
      provide: USER_RESOLVER_TOKEN,
      useValue: { findById: vi.fn().mockResolvedValue({ email: 'db-user@example.com' }) } satisfies UserContactResolver,
    },
  ],
  exports: [DB_CONFIG_TOKEN, USER_RESOLVER_TOKEN],
})
class FakeProvidersModule {}

describe('NotificationModule.forRoot — override tokens', () => {
  it('configToken swaps the whole NotificationConfig, no `channels` data needed', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ model: 'database', configToken: DB_CONFIG_TOKEN, imports: [FakeProvidersModule] })],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent', // only resolvable via the DB-backed fake
      variables: {},
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it('userContactResolverToken swaps in a custom resolver — real production wiring', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          ...STATIC_CONFIG,
          userContactResolverToken: USER_RESOLVER_TOKEN,
          imports: [FakeProvidersModule],
        }),
      ],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'user', id: 'issuer-1' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it("a StaticNotificationConfig subclass under model: 'database': one method dynamic, the rest static", async () => {
    class PartlyDynamic extends StaticNotificationConfig {
      async channelsFor(): Promise<Array<'email'>> {
        return ['email']; // "DB" routing
      }
    }
    const PARTLY = Symbol('PARTLY');

    @Module({
      providers: [{ provide: PARTLY, useValue: new PartlyDynamic(STATIC_CONFIG) }],
      exports: [PARTLY],
    })
    class PartlyModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ model: 'database', configToken: PARTLY, imports: [PartlyModule] })],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'p@e.com' },
      notificationType: 'anything.at.all', // channel from the override, template from the static base
      variables: { invoiceNumber: 'X' },
      tenantId: 'tenant-1',
    });

    // channelsFor → ['email'] (override); email template for 'anything.at.all' → none (static base) → template_not_found
    expect(result.channels?.email).toEqual({ status: 'failed', reason: 'template_not_found' });
  });

  it('overrideProvider still works for tests (USER_CONTACT_RESOLVER)', async () => {
    const users: UserContactResolver = { findById: vi.fn().mockResolvedValue({ email: 'issuer@example.com' }) };
    const moduleRef = await Test.createTestingModule({ imports: [NotificationModule.forRoot(STATIC_CONFIG)] })
      .overrideProvider(USER_CONTACT_RESOLVER)
      .useValue(users)
      .compile();

    const result = await moduleRef.get<Notifier>(NOTIFIER).notify({
      recipient: { type: 'user', id: 'issuer-1' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
    expect(users.findById).toHaveBeenCalledWith('issuer-1');
  });
});
