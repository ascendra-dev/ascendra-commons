import { DynamicModule, Module } from '@nestjs/common';
import { PostgresNotificationConfigAdminService } from './notification-config-admin.service';
import { PostgresNotificationObservabilityService } from './notification-observability.service';
import {
  NOTIFICATION_ADMIN_APPLICATION_ID,
  NOTIFICATION_ADMIN_SQL_EXECUTOR,
  POSTGRES_NOTIFICATION_CONFIG_ADMIN,
  POSTGRES_NOTIFICATION_OBSERVABILITY,
} from './admin-tokens';

export interface PostgresNotificationAdminModuleConfig {
  /** The token the consuming app provides its Drizzle db under — a normal pooled connection. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /** Which Ascendra application this process is — every query/write is scoped to it. */
  application: string;

  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * The notification admin screen's backend:
 *
 *  - `POSTGRES_NOTIFICATION_OBSERVABILITY` — `PostgresNotificationObservabilityService`:
 *    `getDeliveryHistory`, `configCoverageGaps`. Read-only.
 *  - `POSTGRES_NOTIFICATION_CONFIG_ADMIN` — `PostgresNotificationConfigAdminService`:
 *    CRUD on routes / templates / provider credentials.
 *
 * Independent of `PostgresNotificationConfigModule` (the config *reader*) and
 * `PostgresNotificationDeliveryRecorderModule` (the write path) — import
 * whichever you need; all take the same `sqlExecutorToken` / `application`.
 * The endpoints are the consumer's, gated with their own `Authorizer`.
 */
@Module({})
export class PostgresNotificationAdminModule {
  static forRoot(config: PostgresNotificationAdminModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationAdminModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_ADMIN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: NOTIFICATION_ADMIN_APPLICATION_ID, useValue: config.application },
        PostgresNotificationObservabilityService,
        { provide: POSTGRES_NOTIFICATION_OBSERVABILITY, useExisting: PostgresNotificationObservabilityService },
        PostgresNotificationConfigAdminService,
        { provide: POSTGRES_NOTIFICATION_CONFIG_ADMIN, useExisting: PostgresNotificationConfigAdminService },
      ],
      exports: [POSTGRES_NOTIFICATION_OBSERVABILITY, POSTGRES_NOTIFICATION_CONFIG_ADMIN],
    };
  }
}
