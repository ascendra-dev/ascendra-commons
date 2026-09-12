// Schema — re-export from your own schema barrel so drizzle-kit picks it up
export {
  notificationChannelRoute,
  notificationTemplate,
  notificationProviderCredential,
} from './persistence/config.schema';
export { notificationDelivery } from './persistence/delivery.schema';
export type { SqlExecutor } from './persistence/sql-executor';

// Seed — behaviour-preserving model: 'static' -> database
export { seedNotificationConfigFromData } from './seed/seed-from-static-data';

// Config reader (Model 2 NotificationConfig)
export { PostgresNotificationConfig } from './config/postgres-notification-config';
export type { NotificationConfigOptions } from './config/postgres-notification-config';
export { PostgresNotificationConfigModule } from './config/postgres-notification-config.module';
export type { PostgresNotificationConfigModuleConfig } from './config/postgres-notification-config.module';

// Delivery log
export { PostgresNotificationDeliveryRecorder } from './delivery-log/postgres-notification-delivery-recorder';
export { PostgresNotificationDeliveryRecorderModule } from './delivery-log/postgres-notification-delivery-recorder.module';
export type { PostgresNotificationDeliveryRecorderModuleConfig } from './delivery-log/postgres-notification-delivery-recorder.module';

// Admin surface (implements the family ports)
export { PostgresNotificationObservabilityService } from './admin/postgres-notification-observability.service';
export { PostgresNotificationConfigAdminService } from './admin/postgres-notification-config-admin.service';
export { PostgresNotificationAdminModule } from './admin/postgres-notification-admin.module';
export type { PostgresNotificationAdminModuleConfig } from './admin/postgres-notification-admin.module';

export {
  POSTGRES_NOTIFICATION_CONFIG,
  POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
  NOTIFICATION_CONFIG_SQL_EXECUTOR,
  NOTIFICATION_ADMIN_SQL_EXECUTOR,
} from './tokens';
