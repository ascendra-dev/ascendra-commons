import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannel } from './notification.types';
import { NOTIFICATION_CHANNEL_CONFIG_DATA } from './tokens';

/**
 * An interface, not a class — this has genuinely different implementations
 * (static here, database-backed in a consuming project) that share no
 * behavior with each other, so a shared base class would just be ceremony
 * with no payoff. Compare with Notifier, which is a class because it has
 * exactly one implementation with real behavior worth having directly.
 */
export interface NotificationChannelConfig {
  /**
   * `tenantId` is `request.tenantId ?? null` — always passed, never optional
   * on this signature, so every implementation (including a future
   * database-backed one) consciously receives tenant context rather than
   * silently ignoring it by omission. `StaticNotificationChannelConfig`
   * receives it and ignores it, deliberately: see its own doc comment.
   */
  channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]>;
}

/**
 * Data, not code. Adding a new notification type or changing its channels is
 * editing this mapping, not adding an if/else branch anywhere. An
 * unconfigured notificationType resolves to an empty array — fails closed and
 * visibly, rather than guessing a default channel that might be wrong.
 *
 * Belongs in this shared library because it's genuinely generic — has no
 * knowledge of any specific project's schema. A database-backed
 * implementation lives in the consuming project instead, since only that
 * project knows its own schema.
 *
 * Ignores `tenantId` — this is one config for the whole deployment by design,
 * the same tradeoff `StaticRoleMapAuthorizer` makes for personas (see
 * `authorization`'s README, "Model 1 — Static Persona Map"). A tenant needing
 * different channel routing than the deployment default is exactly the signal
 * to build a database-backed `NotificationChannelConfig` instead of adding
 * tenant branching here.
 */
@Injectable()
export class StaticNotificationChannelConfig implements NotificationChannelConfig {
  constructor(
    @Inject(NOTIFICATION_CHANNEL_CONFIG_DATA) private readonly config: Record<string, NotificationChannel[]>,
  ) {}

  async channelsFor(notificationType: string, _tenantId: string | null): Promise<NotificationChannel[]> {
    return this.config[notificationType] ?? [];
  }
}
