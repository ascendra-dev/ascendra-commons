import { DynamicModule, Module, Provider } from '@nestjs/common';
import { NotificationChannel } from './notification.types';
import { NotificationTemplate, StaticNotificationTemplateRepository } from './notification-template';
import { StaticNotificationChannelConfig } from './notification-channel-config';
import { NotificationSender } from './notification-sender';
import { EmailNotificationSender } from './email-notification-sender';
import { WhatsappNotificationSender } from './whatsapp-notification-sender';
import { SMSNotificationSender } from './sms-notification-sender';
import { Notifier } from './notifier';
import { NullUserContactResolver } from './user-contact-resolver';
import {
  NOTIFICATION_CHANNEL_CONFIG,
  NOTIFICATION_CHANNEL_CONFIG_DATA,
  EMAIL_TEMPLATE_DATA,
  EMAIL_TEMPLATE_REPOSITORY,
  SMS_TEMPLATE_DATA,
  SMS_TEMPLATE_REPOSITORY,
  NOTIFICATION_CHANNEL_SENDERS,
  USER_CONTACT_RESOLVER,
  NOTIFIER,
} from './tokens';

/** Any class/string/symbol token NestJS's own `provide`/`inject` accepts — same shape `background-jobs`' `sqlExecutorToken` already uses. */
type OverrideToken = string | symbol | (new (...args: never[]) => unknown);

export interface NotificationModuleConfig {
  /**
   * Which channel(s) each notificationType uses — see StaticNotificationChannelConfig.
   * Required unless `channelConfigToken` is given; ignored if it is.
   */
  channels?: Record<string, NotificationChannel[]>;
  /** Email's own templates, keyed by notificationType. Required unless `emailTemplateRepositoryToken` is given; ignored if it is. */
  emailTemplates?: Record<string, NotificationTemplate>;
  /** SMS's own templates, keyed by notificationType. Required unless `smsTemplateRepositoryToken` is given; ignored if it is. */
  smsTemplates?: Record<string, NotificationTemplate>;

  /**
   * Bind NOTIFICATION_CHANNEL_CONFIG to your own NotificationChannelConfig
   * implementation (e.g. DatabaseNotificationChannelConfig — see this module's
   * README) instead of the built-in StaticNotificationChannelConfig. Omit to
   * use the static one, reading `channels`.
   *
   * This exists because a plain `{ provide: NOTIFICATION_CHANNEL_CONFIG, useClass: ... }`
   * in your own, separate module would NOT actually override what `Notifier`
   * resolves — `Notifier` is constructed inside *this* module's own DI scope,
   * and NestJS provider registries are per-module; a same-named token bound in
   * an unrelated module never reaches it. This token option is the real seam.
   */
  channelConfigToken?: OverrideToken;
  /** Bind EMAIL_TEMPLATE_REPOSITORY to your own NotificationTemplateRepository. Same reasoning as `channelConfigToken`. */
  emailTemplateRepositoryToken?: OverrideToken;
  /** Bind SMS_TEMPLATE_REPOSITORY to your own NotificationTemplateRepository. Same reasoning as `channelConfigToken`. */
  smsTemplateRepositoryToken?: OverrideToken;
  /**
   * Bind USER_CONTACT_RESOLVER to your own UserContactResolver instead of the
   * built-in NullUserContactResolver default. Same reasoning as
   * `channelConfigToken` — unlike the other three, this one isn't really a
   * "Model 1 vs Model 2" choice; NullUserContactResolver is a bootstrapping
   * placeholder, and most real deployments with actual internal users will
   * want a real resolver quickly rather than as an optional upgrade path.
   */
  userContactResolverToken?: OverrideToken;

  /** Whatever module(s) export the token(s) above — same requirement `background-jobs`' `sqlExecutorToken` has, and for the same reason (`useExisting` only resolves a token this module can already see). */
  imports?: DynamicModule['imports'];
}

function requireData<T>(data: T | undefined, dataField: string, tokenField: string): T {
  if (data === undefined) {
    throw new Error(
      `NotificationModule.forRoot() requires either '${dataField}' or '${tokenField}' — ` +
        `pass '${dataField}' to use the built-in static implementation, or '${tokenField}' to bind your own.`,
    );
  }
  return data;
}

/**
 * A dynamic module — as is DomainEventsModule.forRoot() in this same project's
 * domain-events pattern, though that one has a sensible default (transport
 * defaults to 'in-process', so forRoot() there needs no argument). This one
 * doesn't: there's no sensible default channel/template mapping, a consumer
 * always has real business decisions to supply here — for whichever of the
 * four pieces below isn't given an override token.
 *
 * Four independently swappable pieces, not one unified Model 1/Model 2 knob
 * (unlike `authorization`'s `model` or `domain-events`' `transport`) — a real
 * deployment is far more likely to swap one piece (channel routing goes
 * database-backed) than all four atomically, so a single enum would either be
 * dishonest about that or force an all-or-nothing swap nobody asked for. Omit
 * a token and you get the built-in static implementation, reading the
 * matching data field; supply it and `forRoot()` binds your class instead,
 * without requiring (or constructing anything from) the corresponding data.
 */
@Module({})
export class NotificationModule {
  static forRoot(config: NotificationModuleConfig): DynamicModule {
    const channelConfigProviders: Provider[] = config.channelConfigToken
      ? [{ provide: NOTIFICATION_CHANNEL_CONFIG, useExisting: config.channelConfigToken }]
      : [
          { provide: NOTIFICATION_CHANNEL_CONFIG_DATA, useValue: requireData(config.channels, 'channels', 'channelConfigToken') },
          StaticNotificationChannelConfig,
          { provide: NOTIFICATION_CHANNEL_CONFIG, useExisting: StaticNotificationChannelConfig },
        ];

    const emailTemplateProviders: Provider[] = config.emailTemplateRepositoryToken
      ? [{ provide: EMAIL_TEMPLATE_REPOSITORY, useExisting: config.emailTemplateRepositoryToken }]
      : [
          {
            provide: EMAIL_TEMPLATE_DATA,
            useValue: requireData(config.emailTemplates, 'emailTemplates', 'emailTemplateRepositoryToken'),
          },
          {
            provide: EMAIL_TEMPLATE_REPOSITORY,
            useFactory: (templates: Record<string, NotificationTemplate>) =>
              new StaticNotificationTemplateRepository(templates),
            inject: [EMAIL_TEMPLATE_DATA],
          },
        ];

    const smsTemplateProviders: Provider[] = config.smsTemplateRepositoryToken
      ? [{ provide: SMS_TEMPLATE_REPOSITORY, useExisting: config.smsTemplateRepositoryToken }]
      : [
          {
            provide: SMS_TEMPLATE_DATA,
            useValue: requireData(config.smsTemplates, 'smsTemplates', 'smsTemplateRepositoryToken'),
          },
          {
            provide: SMS_TEMPLATE_REPOSITORY,
            useFactory: (templates: Record<string, NotificationTemplate>) =>
              new StaticNotificationTemplateRepository(templates),
            inject: [SMS_TEMPLATE_DATA],
          },
        ];

    const userContactResolverProviders: Provider[] = config.userContactResolverToken
      ? [{ provide: USER_CONTACT_RESOLVER, useExisting: config.userContactResolverToken }]
      : [{ provide: USER_CONTACT_RESOLVER, useClass: NullUserContactResolver }];

    return {
      module: NotificationModule,
      imports: config.imports ?? [],
      providers: [
        ...userContactResolverProviders,
        ...channelConfigProviders,
        ...emailTemplateProviders,
        ...smsTemplateProviders,

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
