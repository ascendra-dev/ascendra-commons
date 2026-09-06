import { DynamicModule, Module, Provider } from '@nestjs/common';
import { NotificationChannel } from './notification.types';
import { NotificationTemplate } from './notification-template';
import {
  NotificationConfig,
  ProviderConfig,
  StaticNotificationConfig,
} from './notification-config';
import { NotificationSender } from './notification-sender';
import { EmailNotificationSender } from './email-notification-sender';
import { WhatsappNotificationSender } from './whatsapp-notification-sender';
import { SMSNotificationSender } from './sms-notification-sender';
import { Notifier } from './notifier';
import { NoopNotificationDeliveryRecorder } from './noop-notification-delivery-recorder';
import { NullUserContactResolver } from './user-contact-resolver';
import {
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFICATION_CONFIG,
  NOTIFICATION_DELIVERY_RECORDER,
  NOTIFIER,
  USER_CONTACT_RESOLVER,
} from './tokens';

/** Any token NestJS's `provide`/`inject` accepts — same shape `background-jobs`' `sqlExecutorToken` uses. */
type OverrideToken = string | symbol | (new (...args: never[]) => unknown);

/** Which `NotificationConfig` backs `NOTIFICATION_CONFIG`. Defaults to `'static'` (Model 1). */
export type NotificationConfigModel = 'static' | 'database';

export interface NotificationModuleConfig {
  /**
   * `'static'` (default) — `StaticNotificationConfig`, Model 1: channel
   * routing, templates, and credentials from the in-memory `channels` /
   * `templates` / `providerConfigs` below. Requires `channels`.
   * `'database'` — Model 2: your own `NotificationConfig` implementation
   * (database-backed, or a `StaticNotificationConfig` subclass overriding one
   * method). Requires `configToken` (+ `imports`).
   *
   * The same `model`-selects-the-implementation shape `authorization`'s `model`
   * and `domain-events`' `transport` use.
   */
  model?: NotificationConfigModel;

  /** notificationType -> channel(s). Required for `model: 'static'`. See `StaticNotificationConfig`. */
  channels?: Record<string, NotificationChannel[]>;
  /**
   * channel -> (notificationType -> template). Optional — a missing entry is a
   * per-send `template_not_found`, not a wiring error. Read only under `model: 'static'`.
   */
  templates?: Partial<Record<NotificationChannel, Record<string, NotificationTemplate>>>;
  /**
   * channel -> (tenantId -> delivery credentials). Optional — a missing entry
   * is a per-send `no_provider_config`. Read only under `model: 'static'`.
   */
  providerConfigs?: Partial<Record<NotificationChannel, Record<string, ProviderConfig>>>;

  /**
   * `model: 'database'` — the injection token your `NotificationConfig` is
   * provided under. `useExisting`-aliased to `NOTIFICATION_CONFIG`.
   *
   * This has to be a `forRoot()` option, not "bind the token in your own
   * module": `Notifier` and the senders are constructed inside *this* module's
   * DI scope, and NestJS provider registries are per-module — a same-named
   * token bound in an unrelated module never reaches them.
   */
  configToken?: OverrideToken;

  /**
   * Bind `USER_CONTACT_RESOLVER` to your own `UserContactResolver` instead of
   * the default `NullUserContactResolver`. Orthogonal to `model` — works with
   * either. The null resolver is a bootstrapping placeholder; most real
   * deployments want a real one quickly.
   */
  userContactResolverToken?: OverrideToken;

  /**
   * Optional — the token a `NotificationDeliveryRecorder` is provided under
   * (e.g. `POSTGRES_NOTIFICATION_DELIVERY_RECORDER` from
   * `adapters/postgres-drizzle`). Omit and the delivery log is a no-op.
   * `Notifier` writes each send's per-channel outcome through it, best-effort.
   */
  deliveryRecorderToken?: OverrideToken;

  /** Whatever module(s) export the token(s) above — `useExisting` only resolves a token this module can already see. */
  imports?: DynamicModule['imports'];
}

/**
 * A dynamic module — `model` selects which `NotificationConfig` backs
 * `NOTIFICATION_CONFIG`, the same shape `authorization`'s `model` and
 * `domain-events`' `transport` use. `'static'` (the default) always needs
 * `channels`; `'database'` needs `configToken`.
 *
 * One config surface (`NotificationConfig`), one override token — not a
 * per-piece grid. A consumer going database-backed writes one class
 * implementing three methods against one schema; a consumer wanting just one
 * method dynamic `extends StaticNotificationConfig` and overrides it.
 */
@Module({})
export class NotificationModule {
  static forRoot(config: NotificationModuleConfig): DynamicModule {
    const model = config.model ?? 'static';
    const configProvider: Provider =
      model === 'database'
        ? { provide: NOTIFICATION_CONFIG, useExisting: requireConfigToken(config.configToken) }
        : {
            provide: NOTIFICATION_CONFIG,
            useValue: new StaticNotificationConfig({
              channels: requireChannels(config.channels),
              templates: config.templates,
              providerConfigs: config.providerConfigs,
            }) satisfies NotificationConfig,
          };

    const userResolverProvider: Provider = config.userContactResolverToken
      ? { provide: USER_CONTACT_RESOLVER, useExisting: config.userContactResolverToken }
      : { provide: USER_CONTACT_RESOLVER, useClass: NullUserContactResolver };

    const deliveryRecorderProvider: Provider = config.deliveryRecorderToken
      ? { provide: NOTIFICATION_DELIVERY_RECORDER, useExisting: config.deliveryRecorderToken }
      : { provide: NOTIFICATION_DELIVERY_RECORDER, useClass: NoopNotificationDeliveryRecorder };

    return {
      module: NotificationModule,
      imports: config.imports ?? [],
      providers: [
        configProvider,
        userResolverProvider,
        deliveryRecorderProvider,

        EmailNotificationSender,
        WhatsappNotificationSender,
        SMSNotificationSender,

        {
          provide: NOTIFICATION_CHANNEL_SENDERS,
          useFactory: (email: EmailNotificationSender, whatsapp: WhatsappNotificationSender, sms: SMSNotificationSender) =>
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

function requireChannels(channels: Record<string, NotificationChannel[]> | undefined): Record<string, NotificationChannel[]> {
  if (channels === undefined) {
    throw new Error("NotificationModule.forRoot({ model: 'static' }) requires 'channels' — or use model: 'database' with 'configToken'.");
  }
  return channels;
}

function requireConfigToken(token: OverrideToken | undefined): OverrideToken {
  if (token === undefined) {
    throw new Error("NotificationModule.forRoot({ model: 'database' }) requires 'configToken' — the token your NotificationConfig is provided under.");
  }
  return token;
}
