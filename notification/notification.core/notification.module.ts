import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { NotificationChannel } from './notification.types';
import { NotificationSender } from './notification-sender.port';
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

/** Any token NestJS's `provide`/`inject` accepts. */
type OverrideToken = string | symbol | (new (...args: never[]) => unknown);

export interface NotificationModuleConfig {
  /**
   * The injection token a `NotificationConfig` implementation is provided under
   * by a module in `imports`. `useExisting`-aliased to `NOTIFICATION_CONFIG`,
   * so `Notifier` and every sender are unaffected by which model is bound.
   *
   *   - Model 1: `STATIC_NOTIFICATION_CONFIG` (notification.core.static)
   *   - Model 2: `POSTGRES_NOTIFICATION_CONFIG`
   *     (notification.core.database.postgres-drizzle), or your own on another stack.
   *
   * Required — `forRoot()` throws without it. (It has to be a `forRoot()` option,
   * not "bind the token in your own module": `Notifier` and the senders are
   * constructed inside *this* module's DI scope, and NestJS provider registries
   * are per-module — a same-named token bound in an unrelated module never
   * reaches them.)
   */
  configToken: OverrideToken;

  /**
   * Bind `USER_CONTACT_RESOLVER` to your own `UserContactResolver` instead of
   * the default `NullUserContactResolver`. The null resolver is a bootstrapping
   * placeholder; most real deployments want a real one quickly.
   */
  userContactResolverToken?: OverrideToken;

  /**
   * Optional — the token a `NotificationDeliveryRecorder` is provided under
   * (e.g. `POSTGRES_NOTIFICATION_DELIVERY_RECORDER`). Omit and the delivery log
   * is a no-op. `Notifier` writes each send's per-channel outcome through it,
   * best-effort.
   */
  deliveryRecorderToken?: OverrideToken;

  /**
   * The real sender for a channel, replacing its stub — e.g. `{ email: SesEmailSender }`. Each is a class implementing
   * `NotificationSender`, constructed **inside this module**, so it can inject `NOTIFICATION_CONFIG` (its
   * credentials, via `providerConfigFor`, and its template), `USER_CONTACT_RESOLVER`, and anything a module in
   * `imports` exports (an SDK client). A channel not named keeps its stub. A real sender returns `providerMessageId`
   * (so a webhook can update the row) and `rendered` (so the delivery log can store the message).
   */
  senders?: Partial<Record<NotificationChannel, Type<NotificationSender>>>;

  /** Whatever module(s) export the token(s) above — `useExisting` only resolves a token this module can already see. */
  imports?: DynamicModule['imports'];
}

/** Each channel's sender class — the stub unless `senders` names a real one. */
const STUBS: Record<NotificationChannel, Type<NotificationSender>> = {
  email: EmailNotificationSender,
  whatsapp: WhatsappNotificationSender,
  sms: SMSNotificationSender,
};

/**
 * The model-agnostic core. `forRoot()` is pure token wiring: it aliases
 * `NOTIFICATION_CONFIG` to `configToken`, binds the user-contact resolver and
 * delivery recorder (defaults or the consumer's tokens), assembles the three
 * senders and the channel map, and provides `Notifier`. It ships no
 * `NotificationConfig` implementation — Model 1 and Model 2 each live in their
 * own package and wire identically.
 */
@Module({})
export class NotificationModule {
  static forRoot(config: NotificationModuleConfig): DynamicModule {
    if (!config?.configToken) {
      throw new Error(
        'NotificationModule.forRoot() requires configToken — the token a NotificationConfig is provided under. ' +
          'Model 1: STATIC_NOTIFICATION_CONFIG from notification.core.static (+ StaticNotificationConfigModule.forRoot). ' +
          'Model 2: POSTGRES_NOTIFICATION_CONFIG from notification.core.database.postgres-drizzle.',
      );
    }

    const userResolverProvider: Provider = config.userContactResolverToken
      ? { provide: USER_CONTACT_RESOLVER, useExisting: config.userContactResolverToken }
      : { provide: USER_CONTACT_RESOLVER, useClass: NullUserContactResolver };

    const channels = Object.keys(STUBS) as NotificationChannel[];
    const senderClasses = channels.map((channel) => config.senders?.[channel] ?? STUBS[channel]);

    const deliveryRecorderProvider: Provider = config.deliveryRecorderToken
      ? { provide: NOTIFICATION_DELIVERY_RECORDER, useExisting: config.deliveryRecorderToken }
      : { provide: NOTIFICATION_DELIVERY_RECORDER, useClass: NoopNotificationDeliveryRecorder };

    return {
      module: NotificationModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_CONFIG, useExisting: config.configToken },
        userResolverProvider,
        deliveryRecorderProvider,

        ...senderClasses,
        {
          provide: NOTIFICATION_CHANNEL_SENDERS,
          useFactory: (...instances: NotificationSender[]) =>
            new Map<NotificationChannel, NotificationSender>(channels.map((channel, i) => [channel, instances[i]])),
          inject: senderClasses,
        },

        Notifier,
        { provide: NOTIFIER, useExisting: Notifier },
      ],
      // The resolver too — notification.api's test send checks a recipient's tenant with it.
      exports: [NOTIFIER, USER_CONTACT_RESOLVER],
    };
  }
}
