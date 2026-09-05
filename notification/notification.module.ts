import { DynamicModule, Module, Provider } from '@nestjs/common';
import { NotificationChannel } from './notification.types';
import { NotificationTemplate, StaticNotificationTemplateRepository } from './notification-template';
import { StaticNotificationChannelConfig } from './notification-channel-config';
import {
  EmailProviderConfig,
  SmsProviderConfig,
  StaticProviderConfigResolver,
  WhatsappProviderConfig,
} from './notification-provider-config';
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
  EMAIL_PROVIDER_CONFIG_DATA,
  EMAIL_PROVIDER_CONFIG,
  SMS_PROVIDER_CONFIG_DATA,
  SMS_PROVIDER_CONFIG,
  WHATSAPP_PROVIDER_CONFIG_DATA,
  WHATSAPP_PROVIDER_CONFIG,
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
   * Email's own delivery-provider credentials, by tenantId — see
   * `EmailProviderConfig`. Required unless `emailProviderConfigToken` is
   * given; ignored if it is. Unlike `channels`/`emailTemplates`, this is keyed
   * by tenantId even in the static, built-in implementation
   * (`StaticProviderConfigResolver`) — "by tenantId" is the actual ask this
   * piece exists for (a tenant bringing their own provider account), not an
   * optional per-tenant override of one deployment-wide default.
   */
  emailProviderConfigs?: Record<string, EmailProviderConfig>;
  /** SMS's own delivery-provider credentials, by tenantId. Same reasoning as `emailProviderConfigs`. Required unless `smsProviderConfigToken` is given; ignored if it is. */
  smsProviderConfigs?: Record<string, SmsProviderConfig>;
  /** WhatsApp's own delivery-provider credentials, by tenantId. Same reasoning as `emailProviderConfigs`. Required unless `whatsappProviderConfigToken` is given; ignored if it is. */
  whatsappProviderConfigs?: Record<string, WhatsappProviderConfig>;

  /** Bind EMAIL_PROVIDER_CONFIG to your own ProviderConfigResolver<EmailProviderConfig> (e.g. database-backed). Same reasoning as `channelConfigToken`. */
  emailProviderConfigToken?: OverrideToken;
  /** Bind SMS_PROVIDER_CONFIG to your own ProviderConfigResolver<SmsProviderConfig>. Same reasoning as `channelConfigToken`. */
  smsProviderConfigToken?: OverrideToken;
  /** Bind WHATSAPP_PROVIDER_CONFIG to your own ProviderConfigResolver<WhatsappProviderConfig>. Same reasoning as `channelConfigToken`. */
  whatsappProviderConfigToken?: OverrideToken;

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
 * seven pieces below isn't given an override token.
 *
 * Seven independently swappable pieces, not one unified Model 1/Model 2 knob
 * (unlike `authorization`'s `model` or `domain-events`' `transport`) — a real
 * deployment is far more likely to swap one piece (channel routing goes
 * database-backed, or one channel's provider credentials do) than all seven
 * atomically, so a single enum would either be dishonest about that or force
 * an all-or-nothing swap nobody asked for. Omit a token and you get the
 * built-in static implementation, reading the matching data field; supply it
 * and `forRoot()` binds your class instead, without requiring (or
 * constructing anything from) the corresponding data.
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

    const emailProviderConfigProviders: Provider[] = config.emailProviderConfigToken
      ? [{ provide: EMAIL_PROVIDER_CONFIG, useExisting: config.emailProviderConfigToken }]
      : [
          {
            provide: EMAIL_PROVIDER_CONFIG_DATA,
            useValue: requireData(config.emailProviderConfigs, 'emailProviderConfigs', 'emailProviderConfigToken'),
          },
          {
            provide: EMAIL_PROVIDER_CONFIG,
            useFactory: (configs: Record<string, EmailProviderConfig>) => new StaticProviderConfigResolver(configs),
            inject: [EMAIL_PROVIDER_CONFIG_DATA],
          },
        ];

    const smsProviderConfigProviders: Provider[] = config.smsProviderConfigToken
      ? [{ provide: SMS_PROVIDER_CONFIG, useExisting: config.smsProviderConfigToken }]
      : [
          {
            provide: SMS_PROVIDER_CONFIG_DATA,
            useValue: requireData(config.smsProviderConfigs, 'smsProviderConfigs', 'smsProviderConfigToken'),
          },
          {
            provide: SMS_PROVIDER_CONFIG,
            useFactory: (configs: Record<string, SmsProviderConfig>) => new StaticProviderConfigResolver(configs),
            inject: [SMS_PROVIDER_CONFIG_DATA],
          },
        ];

    const whatsappProviderConfigProviders: Provider[] = config.whatsappProviderConfigToken
      ? [{ provide: WHATSAPP_PROVIDER_CONFIG, useExisting: config.whatsappProviderConfigToken }]
      : [
          {
            provide: WHATSAPP_PROVIDER_CONFIG_DATA,
            useValue: requireData(
              config.whatsappProviderConfigs,
              'whatsappProviderConfigs',
              'whatsappProviderConfigToken',
            ),
          },
          {
            provide: WHATSAPP_PROVIDER_CONFIG,
            useFactory: (configs: Record<string, WhatsappProviderConfig>) => new StaticProviderConfigResolver(configs),
            inject: [WHATSAPP_PROVIDER_CONFIG_DATA],
          },
        ];

    return {
      module: NotificationModule,
      imports: config.imports ?? [],
      providers: [
        ...userContactResolverProviders,
        ...channelConfigProviders,
        ...emailTemplateProviders,
        ...smsTemplateProviders,
        ...emailProviderConfigProviders,
        ...smsProviderConfigProviders,
        ...whatsappProviderConfigProviders,

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
