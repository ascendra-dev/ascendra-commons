import { DynamicModule, Module } from '@nestjs/common';
import { PostgresNotificationConfig } from './postgres-notification-config';
import {
  NOTIFICATION_CONFIG_OPTIONS,
  NOTIFICATION_CONFIG_SQL_EXECUTOR,
  POSTGRES_NOTIFICATION_CONFIG,
} from './tokens';

export interface PostgresNotificationConfigModuleConfig {
  /** The injection token the consuming app already provides its Drizzle db client under. Aliased via `useExisting`. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Which Ascendra app this process is (e.g. `'ascendra-pay'`) — written on
   * every row and filtered on every read, so the tables stay correct whether
   * each app keeps its own database or they are ever consolidated. The same
   * string the consumer passes to `DomainEventsModule.forRoot({ application })`.
   */
  application: string;

  /**
   * Config-cache TTL in seconds. Default 30. `0` disables the cache (every
   * `channelsFor`/`templateFor`/`providerConfigFor` queries). A change to a
   * routing/template/credential row is visible after at most this long.
   */
  cacheTtlSeconds?: number;

  /** Whatever module(s) export the provider behind `sqlExecutorToken`. */
  imports?: DynamicModule['imports'];
}

/**
 * Wires `PostgresNotificationConfig` and exports it as
 * `POSTGRES_NOTIFICATION_CONFIG`:
 *
 * ```typescript
 * NotificationModule.forRoot({
 *   model: 'database',
 *   configToken: POSTGRES_NOTIFICATION_CONFIG,
 *   imports: [
 *     PostgresNotificationConfigModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION,
 *       application: 'ascendra-pay',
 *       imports: [DatabaseModule],
 *     }),
 *   ],
 * })
 * ```
 */
@Module({})
export class PostgresNotificationConfigModule {
  static forRoot(config: PostgresNotificationConfigModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationConfigModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_CONFIG_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        {
          provide: NOTIFICATION_CONFIG_OPTIONS,
          useValue: { application: config.application, cacheTtlSeconds: config.cacheTtlSeconds ?? 30 },
        },
        PostgresNotificationConfig,
        { provide: POSTGRES_NOTIFICATION_CONFIG, useExisting: PostgresNotificationConfig },
      ],
      exports: [POSTGRES_NOTIFICATION_CONFIG],
    };
  }
}
