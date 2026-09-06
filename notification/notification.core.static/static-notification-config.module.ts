import { DynamicModule, Module } from '@nestjs/common';
import type { NotificationConfigData } from '../notification.core';
import { StaticNotificationConfig } from './static-notification-config';
import { STATIC_NOTIFICATION_CONFIG, STATIC_NOTIFICATION_CONFIG_DATA } from './tokens';

export interface StaticNotificationConfigModuleConfig extends NotificationConfigData {}

/**
 * Model 1 wiring. Binds `StaticNotificationConfig` (reading the in-memory
 * `channels` / `templates` / `providerConfigs`) and exports it under
 * `STATIC_NOTIFICATION_CONFIG`.
 *
 * ```typescript
 * NotificationModule.forRoot({
 *   configToken: STATIC_NOTIFICATION_CONFIG,
 *   imports: [
 *     StaticNotificationConfigModule.forRoot({
 *       channels: { 'invoice.sent': ['email'] },
 *       templates: { email: { 'invoice.sent': { subject: '...', body: '...' } } },
 *       providerConfigs: { email: { 'tenant-a': { apiKey: '...' } } },
 *     }),
 *   ],
 * })
 * ```
 *
 * `channels` is required — an unconfigured `notificationType` resolves to zero
 * channels (`no_channel_configured`). `templates`/`providerConfigs` are optional
 * — a missing entry is a graceful per-send failure, not a wiring error.
 */
@Module({})
export class StaticNotificationConfigModule {
  static forRoot(config: StaticNotificationConfigModuleConfig): DynamicModule {
    if (!config?.channels) {
      throw new Error(
        "StaticNotificationConfigModule.forRoot() requires 'channels' — a notificationType -> channel[] map.",
      );
    }
    const data: NotificationConfigData = {
      channels: config.channels,
      templates: config.templates,
      providerConfigs: config.providerConfigs,
    };
    return {
      module: StaticNotificationConfigModule,
      providers: [
        { provide: STATIC_NOTIFICATION_CONFIG_DATA, useValue: data },
        { provide: StaticNotificationConfig, useValue: new StaticNotificationConfig(data) },
        { provide: STATIC_NOTIFICATION_CONFIG, useExisting: StaticNotificationConfig },
      ],
      exports: [STATIC_NOTIFICATION_CONFIG],
    };
  }
}
