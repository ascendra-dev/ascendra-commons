import { describe, expect, it, vi } from 'vitest';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationModule } from './notification.module';
import { Notifier } from './notifier';
import type { NotificationConfig } from './notification-config.port';
import type { UserContactResolver } from './user-contact-resolver';
import type { NotificationDeliveryRecorder } from './notification-delivery-recorder.port';
import { EmailNotificationSender } from './email-notification-sender';
import type { NotificationSender } from './notification-sender.port';
import type { NotificationRequest } from './notification.types';
import {
  NOTIFICATION_CONFIG,
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFICATION_DELIVERY_RECORDER,
  NOTIFIER,
  NOTIFICATION_TYPES,
  USER_CONTACT_RESOLVER,
} from './tokens';

const CONFIG_TOKEN = Symbol('CONFIG_TOKEN');
const USER_RESOLVER_TOKEN = Symbol('USER_RESOLVER_TOKEN');
const RECORDER_TOKEN = Symbol('RECORDER_TOKEN');

const recordAttempts = vi.fn().mockResolvedValue(undefined);

/** Stands in for a consuming project's own providers module — the real production path. */
@Module({
  providers: [
    {
      provide: CONFIG_TOKEN,
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
    {
      provide: RECORDER_TOKEN,
      useValue: { recordAttempts, updateDeliveryStatus: vi.fn() } satisfies NotificationDeliveryRecorder,
    },
  ],
  exports: [CONFIG_TOKEN, USER_RESOLVER_TOKEN, RECORDER_TOKEN],
})
class FakeProvidersModule {}

describe('NotificationModule.forRoot — token wiring', () => {
  it('throws without configToken', () => {
    // @ts-expect-error — deliberately omitting the required field
    expect(() => NotificationModule.forRoot({})).toThrow(/requires configToken/);
  });

  it('aliases NOTIFICATION_CONFIG to configToken and resolves NOTIFIER to the Notifier', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ configToken: CONFIG_TOKEN, imports: [FakeProvidersModule] })],
    }).compile();

    expect(moduleRef.get(NOTIFIER)).toBe(moduleRef.get(Notifier));

    const result = await moduleRef.get<Notifier>(NOTIFIER).notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 'tenant-1',
    });
    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' } } });
  });

  it('assembles the three senders into the channel map', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ configToken: CONFIG_TOKEN, imports: [FakeProvidersModule] })],
    }).compile();

    const senders = moduleRef.get(NOTIFICATION_CHANNEL_SENDERS);
    expect([...senders.keys()].sort()).toEqual(['email', 'sms', 'whatsapp']);
  });

  it("senders replaces one channel's stub with a real sender, built here so it can inject the config", async () => {
    @Injectable()
    class RealEmailSender implements NotificationSender {
      constructor(@Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig) {}
      async send(request: NotificationRequest) {
        const credential = await this.config.providerConfigFor('email', request.tenantId ?? null);
        return { status: 'sent' as const, providerMessageId: `ses-${String(credential?.apiKey)}` };
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ configToken: CONFIG_TOKEN, senders: { email: RealEmailSender }, imports: [FakeProvidersModule] })],
    }).compile();

    const senders = moduleRef.get(NOTIFICATION_CHANNEL_SENDERS);
    expect(senders.get('email')).toBeInstanceOf(RealEmailSender);
    expect(senders.get('email')).not.toBeInstanceOf(EmailNotificationSender);
    expect([...senders.keys()].sort()).toEqual(['email', 'sms', 'whatsapp']);

    const result = await moduleRef.get<Notifier>(NOTIFIER).notify({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 'tenant-1',
    });
    expect(result.channels?.email).toEqual({ status: 'sent', providerMessageId: 'ses-k' });
  });

  it('exports the declared types (none by default), and refuses a type or a variable declared twice', async () => {
    const none = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ configToken: CONFIG_TOKEN, imports: [FakeProvidersModule] })],
    }).compile();
    expect(none.get(NOTIFICATION_TYPES)).toEqual([]);
    const types = [{ name: 'invoice.sent', variables: [{ name: 'amount' }] }];
    const some = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ configToken: CONFIG_TOKEN, types, imports: [FakeProvidersModule] })],
    }).compile();
    expect(some.get(NOTIFICATION_TYPES)).toEqual(types);
    expect(() => NotificationModule.forRoot({ configToken: CONFIG_TOKEN, types: [{ name: 'a' }, { name: 'a' }] })).toThrow(/declared twice/);
    expect(() => NotificationModule.forRoot({ configToken: CONFIG_TOKEN, types: [{ name: 'a', variables: [{ name: 'x-y' }] }] })).toThrow(/letters, digits/);
  });

  it('defaults USER_CONTACT_RESOLVER to the null resolver; userContactResolverToken overrides it', async () => {
    const withDefault = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ configToken: CONFIG_TOKEN, imports: [FakeProvidersModule] })],
    }).compile();
    await expect(withDefault.get<UserContactResolver>(USER_CONTACT_RESOLVER).findById('x')).resolves.toBeNull();

    const overridden = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          configToken: CONFIG_TOKEN,
          userContactResolverToken: USER_RESOLVER_TOKEN,
          imports: [FakeProvidersModule],
        }),
      ],
    }).compile();
    await expect(overridden.get<UserContactResolver>(USER_CONTACT_RESOLVER).findById('x')).resolves.toEqual({
      email: 'db-user@example.com',
    });
  });

  it('defaults the delivery recorder to a no-op; deliveryRecorderToken wires a real one that Notifier calls', async () => {
    const withDefault = await Test.createTestingModule({
      imports: [NotificationModule.forRoot({ configToken: CONFIG_TOKEN, imports: [FakeProvidersModule] })],
    }).compile();
    await expect(
      withDefault.get<NotificationDeliveryRecorder>(NOTIFICATION_DELIVERY_RECORDER).recordAttempts([]),
    ).resolves.toBeUndefined();

    recordAttempts.mockClear();
    const wired = await Test.createTestingModule({
      imports: [
        NotificationModule.forRoot({
          configToken: CONFIG_TOKEN,
          deliveryRecorderToken: RECORDER_TOKEN,
          imports: [FakeProvidersModule],
        }),
      ],
    }).compile();

    await wired.get<Notifier>(NOTIFIER).notify({
      recipient: { type: 'raw', email: 'p@e.com' },
      notificationType: 'invoice.sent',
      variables: {},
      tenantId: 'tenant-1',
    });
    expect(recordAttempts).toHaveBeenCalledOnce();
  });
});
