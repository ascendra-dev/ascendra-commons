import { DynamicModule, Module } from '@nestjs/common';
import { NotificationChannel } from './notification.types';
import { NotificationTemplate, StaticNotificationTemplateRepository } from './notification-template';
import { StaticNotificationChannelConfig } from './notification-channel-config';
import { NotificationSender } from './notification-sender';
import { EmailNotificationSender } from './email-notification-sender';
import { WhatsappNotificationSender } from './whatsapp-notification-sender';
import { SMSNotificationSender } from './sms-notification-sender';
import { Notifier } from './notifier';
import {
  NOTIFICATION_CHANNEL_CONFIG,
  NOTIFICATION_CHANNEL_CONFIG_DATA,
  EMAIL_TEMPLATE_DATA,
  EMAIL_TEMPLATE_REPOSITORY,
  SMS_TEMPLATE_DATA,
  SMS_TEMPLATE_REPOSITORY,
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFIER,
} from './tokens';

export interface NotificationModuleConfig {
  /** Which channel(s) each notificationType uses — see StaticNotificationChannelConfig. */
  channels: Record<string, NotificationChannel[]>;
  /** Email's own templates, keyed by notificationType. */
  emailTemplates: Record<string, NotificationTemplate>;
  /** SMS's own templates, keyed by notificationType — separate from email's, per-channel ownership. */
  smsTemplates: Record<string, NotificationTemplate>;
}

/**
 * A dynamic module — mirrors EventEmitterModule.forRoot() in this same
 * project's domain-events pattern. Requires config because there is no
 * sensible default channel/template mapping; a consumer always has real
 * business decisions to supply here, unlike domain-events' emitter, which
 * genuinely has nothing to configure.
 */
@Module({})
export class NotificationModule {
  static forRoot(config: NotificationModuleConfig): DynamicModule {
    return {
      module: NotificationModule,
      providers: [
        { provide: NOTIFICATION_CHANNEL_CONFIG_DATA, useValue: config.channels },
        StaticNotificationChannelConfig,
        { provide: NOTIFICATION_CHANNEL_CONFIG, useExisting: StaticNotificationChannelConfig },

        { provide: EMAIL_TEMPLATE_DATA, useValue: config.emailTemplates },
        {
          provide: EMAIL_TEMPLATE_REPOSITORY,
          useFactory: (templates: Record<string, NotificationTemplate>) =>
            new StaticNotificationTemplateRepository(templates),
          inject: [EMAIL_TEMPLATE_DATA],
        },

        { provide: SMS_TEMPLATE_DATA, useValue: config.smsTemplates },
        {
          provide: SMS_TEMPLATE_REPOSITORY,
          useFactory: (templates: Record<string, NotificationTemplate>) =>
            new StaticNotificationTemplateRepository(templates),
          inject: [SMS_TEMPLATE_DATA],
        },

        EmailNotificationSender,
        WhatsappNotificationSender,
        SMSNotificationSender,

        {
          provide: NOTIFICATION_CHANNEL_SENDERS,
          useFactory: (
            email: EmailNotificationSender,
            whatsapp: WhatsappNotificationSender,
            sms: SMSNotificationSender,
          ) =>
            new Map<NotificationChannel, NotificationSender>([
              ['email', email],
              ['whatsapp', whatsapp],
              ['sms', sms],
            ]),
          inject: [EmailNotificationSender, WhatsappNotificationSender, SMSNotificationSender],
        },

        Notifier,
        { provide: NOTIFIER, useExisting: Notifier },
      ],
      exports: [NOTIFIER],
    };
  }
}
