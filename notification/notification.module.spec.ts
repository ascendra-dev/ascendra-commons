import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationModule } from './notification.module';
import { Notifier } from './notifier';
import { UserContactResolver } from './user-contact-resolver';
import { NotificationChannelConfig } from './notification-channel-config';
import { NotificationChannel } from './notification.types';
import { NotificationTemplateRepository } from './notification-template';
import { EmailProviderConfig, ProviderConfigResolver } from './notification-provider-config';
import { NOTIFIER, USER_CONTACT_RESOLVER } from './tokens';

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
        emailProviderConfigs: { 'tenant-1': { apiKey: 'email-key', fromAddress: 'billing@example.com' } },
        smsProviderConfigs: { 'tenant-1': { apiKey: 'sms-key', fromNumber: '+10000000000' } },
        whatsappProviderConfigs: { 'tenant-1': { apiKey: 'wa-key', fromNumber: '+10000000001' } },
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
      tenantId: 'tenant-1',
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
      tenantId: 'tenant-1',
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
      tenantId: 'tenant-1',
    });

    // email has no template for this notificationType, sms does — so the
    // honest aggregate is 'partial', not 'sent'.
    expect(result.status).toBe('partial');
    expect(result.channels?.email).toEqual({ status: 'failed', reason: 'template_not_found' });
    expect(result.channels?.sms).toEqual({ status: 'sent' });
  });

  it('the default NullUserContactResolver fails a user recipient closed, real DI included', async () => {
    const moduleRef = await buildTestModule();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'user', id: 'issuer-1' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
    });

    expect(result).toEqual({ status: 'failed', channels: { email: { status: 'failed', reason: 'no_address_available' } } });
  });

  it('overriding USER_CONTACT_RESOLVER in a consumer-style module lets a user recipient resolve', async () => {
    const users: UserContactResolver = { findById: vi.fn().mockResolvedValue({ email: 'issuer@example.com' }) };

    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          channels: { 'invoice.sent': ['email'] },
          emailTemplates: { 'invoice.sent': { subject: 'Invoice {{invoiceNumber}}', body: 'Hi' } },
          smsTemplates: {},
          emailProviderConfigs: { 'tenant-1': { apiKey: 'email-key', fromAddress: 'billing@example.com' } },
          smsProviderConfigs: {},
          whatsappProviderConfigs: {},
        }),
      ],
    })
      .overrideProvider(USER_CONTACT_RESOLVER)
      .useValue(users)
      .compile();

    const notifier = moduleRef.get<Notifier>(NOTIFIER);
    const result = await notifier.notify({
      recipient: { type: 'user', id: 'issuer-1' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
    expect(users.findById).toHaveBeenCalledWith('issuer-1');
  });
});

const CHANNEL_CONFIG_TOKEN = Symbol('CHANNEL_CONFIG_TOKEN');
const EMAIL_TEMPLATE_REPO_TOKEN = Symbol('EMAIL_TEMPLATE_REPO_TOKEN');
const USER_RESOLVER_TOKEN = Symbol('USER_RESOLVER_TOKEN');

/**
 * Stands in for a consuming project's own database-backed providers module —
 * the real production path (`imports` + a `*Token` field), not the test-only
 * `.overrideProvider()` mechanism `@nestjs/testing` offers. This is what
 * actually proves the seam works outside a test, since `Notifier` is
 * constructed inside NotificationModule's own DI scope and can't be reached
 * by re-declaring the same token in an unrelated module.
 */
@Module({
  providers: [
    {
      provide: CHANNEL_CONFIG_TOKEN,
      useValue: { channelsFor: vi.fn().mockResolvedValue(['email']) } satisfies NotificationChannelConfig,
    },
    {
      provide: EMAIL_TEMPLATE_REPO_TOKEN,
      useValue: {
        templateFor: vi.fn().mockResolvedValue({ subject: 'DB Subject', body: 'DB Body' }),
      } satisfies NotificationTemplateRepository,
    },
    {
      provide: USER_RESOLVER_TOKEN,
      useValue: { findById: vi.fn().mockResolvedValue({ email: 'db-user@example.com' }) } satisfies UserContactResolver,
    },
  ],
  exports: [CHANNEL_CONFIG_TOKEN, EMAIL_TEMPLATE_REPO_TOKEN, USER_RESOLVER_TOKEN],
})
class FakeDatabaseNotificationProvidersModule {}

describe('NotificationModule.forRoot — override tokens, the real Model 2 seam', () => {
  it('channelConfigToken swaps in a custom NotificationChannelConfig, no `channels` data needed', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          channelConfigToken: CHANNEL_CONFIG_TOKEN,
          imports: [FakeDatabaseNotificationProvidersModule],
          emailTemplates: { 'invoice.sent': { subject: 'Invoice {{invoiceNumber}}', body: 'Hi' } },
          smsTemplates: {},
          emailProviderConfigs: { 'tenant-1': { apiKey: 'email-key', fromAddress: 'billing@example.com' } },
          smsProviderConfigs: {},
          whatsappProviderConfigs: {},
        }),
      ],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      // No `channels` data was given at all — this notificationType can only
      // have resolved to ['email'] via the DB-backed fake, never a static lookup.
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it('emailTemplateRepositoryToken swaps in a custom NotificationTemplateRepository', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          channels: { 'invoice.sent': ['email'] },
          emailTemplateRepositoryToken: EMAIL_TEMPLATE_REPO_TOKEN,
          imports: [FakeDatabaseNotificationProvidersModule],
          smsTemplates: {},
          emailProviderConfigs: { 'tenant-1': { apiKey: 'email-key', fromAddress: 'billing@example.com' } },
          smsProviderConfigs: {},
          whatsappProviderConfigs: {},
        }),
      ],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it('userContactResolverToken swaps in a custom UserContactResolver — real production wiring, not .overrideProvider()', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          channels: { 'invoice.sent': ['email'] },
          emailTemplates: { 'invoice.sent': { subject: 'Invoice {{invoiceNumber}}', body: 'Hi' } },
          smsTemplates: {},
          userContactResolverToken: USER_RESOLVER_TOKEN,
          imports: [FakeDatabaseNotificationProvidersModule],
          emailProviderConfigs: { 'tenant-1': { apiKey: 'email-key', fromAddress: 'billing@example.com' } },
          smsProviderConfigs: {},
          whatsappProviderConfigs: {},
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

  it('a partial swap works: channelConfigToken overridden, templates still static — the realistic case', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          channelConfigToken: CHANNEL_CONFIG_TOKEN,
          imports: [FakeDatabaseNotificationProvidersModule],
          emailTemplates: { 'invoice.sent': { subject: 'Static Subject', body: 'Static Body' } },
          smsTemplates: {},
          emailProviderConfigs: { 'tenant-1': { apiKey: 'email-key', fromAddress: 'billing@example.com' } },
          smsProviderConfigs: {},
          whatsappProviderConfigs: {},
        }),
      ],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent', // channel comes from the DB-backed fake; template still comes from the static map
      variables: {},
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it('throws clearly when neither channels nor channelConfigToken is given', () => {
    expect(() =>
      NotificationModule.forRoot({ emailTemplates: {}, smsTemplates: {} }),
    ).toThrow(/requires either 'channels' or 'channelConfigToken'/);
  });

  it('throws clearly when neither emailTemplates nor emailTemplateRepositoryToken is given', () => {
    expect(() =>
      NotificationModule.forRoot({ channels: {}, smsTemplates: {} }),
    ).toThrow(/requires either 'emailTemplates' or 'emailTemplateRepositoryToken'/);
  });

  it('throws clearly when neither smsTemplates nor smsTemplateRepositoryToken is given', () => {
    expect(() =>
      NotificationModule.forRoot({ channels: {}, emailTemplates: {} }),
    ).toThrow(/requires either 'smsTemplates' or 'smsTemplateRepositoryToken'/);
  });

  it('throws clearly when neither emailProviderConfigs nor emailProviderConfigToken is given', () => {
    expect(() =>
      NotificationModule.forRoot({ channels: {}, emailTemplates: {}, smsTemplates: {} }),
    ).toThrow(/requires either 'emailProviderConfigs' or 'emailProviderConfigToken'/);
  });

  it('throws clearly when neither smsProviderConfigs nor smsProviderConfigToken is given', () => {
    expect(() =>
      NotificationModule.forRoot({ channels: {}, emailTemplates: {}, smsTemplates: {}, emailProviderConfigs: {} }),
    ).toThrow(/requires either 'smsProviderConfigs' or 'smsProviderConfigToken'/);
  });

  it('throws clearly when neither whatsappProviderConfigs nor whatsappProviderConfigToken is given', () => {
    expect(() =>
      NotificationModule.forRoot({
        channels: {},
        emailTemplates: {},
        smsTemplates: {},
        emailProviderConfigs: {},
        smsProviderConfigs: {},
      }),
    ).toThrow(/requires either 'whatsappProviderConfigs' or 'whatsappProviderConfigToken'/);
  });

  it('emailProviderConfigToken swaps in a custom ProviderConfigResolver<EmailProviderConfig>, real production wiring', async () => {
    const EMAIL_PROVIDER_CONFIG_TOKEN = Symbol('EMAIL_PROVIDER_CONFIG_TOKEN');

    @Module({
      providers: [
        {
          provide: EMAIL_PROVIDER_CONFIG_TOKEN,
          useValue: {
            configFor: vi.fn().mockResolvedValue({ apiKey: 'db-key', fromAddress: 'db@example.com' }),
          } satisfies ProviderConfigResolver<EmailProviderConfig>,
        },
      ],
      exports: [EMAIL_PROVIDER_CONFIG_TOKEN],
    })
    class FakeDatabaseEmailProviderConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          channels: { 'invoice.sent': ['email'] },
          emailTemplates: { 'invoice.sent': { subject: 'Invoice {{invoiceNumber}}', body: 'Hi' } },
          smsTemplates: {},
          emailProviderConfigToken: EMAIL_PROVIDER_CONFIG_TOKEN,
          smsProviderConfigs: {},
          whatsappProviderConfigs: {},
          imports: [FakeDatabaseEmailProviderConfigModule],
        }),
      ],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      // No `emailProviderConfigs` data was given at all — this can only have
      // resolved via the DB-backed fake, never a static tenant-map lookup.
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
      tenantId: 'any-tenant-at-all', // the fake resolves every tenantId identically — proves the seam, not tenant-keying
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it('fails closed when a tenant has no registered provider config, real DI included', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          channels: { 'invoice.sent': ['email'] },
          emailTemplates: { 'invoice.sent': { subject: 'Invoice {{invoiceNumber}}', body: 'Hi' } },
          smsTemplates: {},
          emailProviderConfigs: { 'tenant-1': { apiKey: 'email-key', fromAddress: 'billing@example.com' } },
          smsProviderConfigs: {},
          whatsappProviderConfigs: {},
        }),
      ],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
      tenantId: 'a-tenant-with-no-provider-config',
    });

    expect(result).toEqual({ status: 'failed', channels: { email: { status: 'failed', reason: 'no_provider_config' } } });
  });
});

describe('an applicationId value, provided entirely within the consumer\'s own module, never by forRoot()', () => {
  it('a consumer module can provide its own app-id token and inject it into its own override class, in the same scope', async () => {
    // Not exported by this library — nothing here reads it by a fixed name,
    // so there's no shared token to import. The consuming project declares
    // its own, the same way it already declares APP_ID_AWARE_CHANNEL_CONFIG
    // below (see this module's README, "Going to a database-backed channel
    // config").
    const APPLICATION_ID = Symbol('APPLICATION_ID');
    const APP_ID_AWARE_CHANNEL_CONFIG = Symbol('APP_ID_AWARE_CHANNEL_CONFIG');

    // Stands in for a real project's own notification-providers module — the
    // app-id value and the class that injects it are declared together,
    // here, because forRoot() cannot deliver a value into a module it merely
    // imports FROM (see this module's README).
    @Module({
      providers: [
        { provide: APPLICATION_ID, useValue: 'ascendra-pay' },
        {
          provide: APP_ID_AWARE_CHANNEL_CONFIG,
          useFactory: (appId: string): NotificationChannelConfig => ({
            channelsFor: vi.fn(async (): Promise<NotificationChannel[]> => (appId === 'ascendra-pay' ? ['email'] : [])),
          }),
          inject: [APPLICATION_ID],
        },
      ],
      exports: [APP_ID_AWARE_CHANNEL_CONFIG],
    })
    class MyNotificationProvidersModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          channelConfigToken: APP_ID_AWARE_CHANNEL_CONFIG,
          imports: [MyNotificationProvidersModule],
          emailTemplates: { 'invoice.sent': { subject: 'Invoice ready', body: 'Hi' } },
          smsTemplates: {},
          emailProviderConfigs: { 'tenant-1': { apiKey: 'email-key', fromAddress: 'billing@example.com' } },
          smsProviderConfigs: {},
          whatsappProviderConfigs: {},
        }),
      ],
    }).compile();
    const notifier = moduleRef.get<Notifier>(NOTIFIER);

    const result = await notifier.notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });
});
