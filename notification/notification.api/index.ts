export { NotificationApiModule } from './notification-api.module';
export type { NotificationApiModuleConfig } from './notification-api.options';
export { NOTIFICATION_ACTIONS } from './notification-api.options';

export type { NotificationAuditEmitter, NotificationAuditEvent } from './notification-audit.port';
export { NoopNotificationAuditEmitter } from './notification-audit.port';
export { NOTIFICATION_AUDIT_EMITTER, NOTIFICATION_API_OPTIONS } from './tokens';

export type {
  DeliveryHistoryQueryDto,
  DeliveryStatsQueryDto,
  PreviewTemplateBody,
  SetChannelRouteBody,
  SetTemplateBody,
  SetProviderCredentialBody,
  TestSendBody,
} from './dto/notification-api.dto';
