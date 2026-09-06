export type {
  NotificationRecipient,
  NotificationRequest,
  NotificationChannel,
  NotificationChannelResult,
  NotificationResult,
} from './notification.types';

export type { NotificationConfig, NotificationConfigData, ProviderConfig } from './notification-config';
export { StaticNotificationConfig } from './notification-config';

export type { NotificationTemplate } from './notification-template';
export { renderTemplate } from './notification-template';

export type { NotificationSender } from './notification-sender';
export { EmailNotificationSender } from './email-notification-sender';
export { WhatsappNotificationSender } from './whatsapp-notification-sender';
export { SMSNotificationSender } from './sms-notification-sender';

export type { UserContactResolver } from './user-contact-resolver';
export { NullUserContactResolver } from './user-contact-resolver';

export { Notifier, NotificationDeliveryError } from './notifier';

export type {
  NotificationDeliveryRecorder,
  DeliveryAttempt,
  DeliveryStatusUpdate,
} from './notification-delivery-recorder';
export { NoopNotificationDeliveryRecorder } from './noop-notification-delivery-recorder';

export { NotificationModule } from './notification.module';
export type { NotificationModuleConfig, NotificationConfigModel } from './notification.module';

export {
  NOTIFICATION_CONFIG,
  USER_CONTACT_RESOLVER,
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFIER,
  NOTIFICATION_DELIVERY_RECORDER,
} from './tokens';
