import { DynamicModule, Module } from '@nestjs/common';
import { PostgresNotificationDeliveryRecorder } from './postgres-notification-delivery-recorder';
import {
  NOTIFICATION_ADMIN_APPLICATION_ID,
  NOTIFICATION_ADMIN_SQL_EXECUTOR,
  NOTIFICATION_ADMIN_STORE_CONTENT,
  POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
} from './admin-tokens';

export interface PostgresNotificationDeliveryRecorderModuleConfig {
  /** The token the consuming app provides its Drizzle db under — a normal pooled connection. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /** Which Ascendra application this process is — stamped on every delivery row. */
  application: string;

  /**
   * When `true`, the recorder writes the rendered message + variables to the
   * nullable `content` jsonb column — a light message archive, pruned with the
   * row. **Full-fidelity, PII-bearing.** Default `false` (the `content` column
   * stays NULL). For long-retention / legal archival use `file-storage`, not this.
   */
  storeContent?: boolean;

  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Provides `PostgresNotificationDeliveryRecorder` and exports it as
 * `POSTGRES_NOTIFICATION_DELIVERY_RECORDER`. Pass that token — and this module
 * in the same `imports` array — to `NotificationModule.forRoot()`:
 *
 * ```typescript
 * NotificationModule.forRoot({
 *   model: 'database',
 *   configToken: POSTGRES_NOTIFICATION_CONFIG,
 *   deliveryRecorderToken: POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
 *   imports: [
 *     PostgresNotificationConfigModule.forRoot({ ... }),
 *     PostgresNotificationDeliveryRecorderModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule],
 *     }),
 *   ],
 * })
 * ```
 *
 * Requires the `commons_notification_delivery` migration.
 */
@Module({})
export class PostgresNotificationDeliveryRecorderModule {
  static forRoot(config: PostgresNotificationDeliveryRecorderModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationDeliveryRecorderModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_ADMIN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: NOTIFICATION_ADMIN_APPLICATION_ID, useValue: config.application },
        { provide: NOTIFICATION_ADMIN_STORE_CONTENT, useValue: config.storeContent ?? false },
        PostgresNotificationDeliveryRecorder,
        { provide: POSTGRES_NOTIFICATION_DELIVERY_RECORDER, useExisting: PostgresNotificationDeliveryRecorder },
      ],
      exports: [POSTGRES_NOTIFICATION_DELIVERY_RECORDER],
    };
  }
}
