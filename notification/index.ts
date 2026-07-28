export type {
  NotificationRecipient,
  NotificationRequest,
  NotificationChannel,
  NotificationChannelResult,
  NotificationResult,
} from './notification.types';

export type { NotificationChannelConfig } from './notification-channel-config';
export { StaticNotificationChannelConfig } from './notification-channel-config';

export type { NotificationTemplate, NotificationTemplateRepository } from './notification-template';
export { StaticNotificationTemplateRepository, renderTemplate } from './notification-template';

export type { NotificationSender } from './notification-sender';
export { EmailNotificationSender } from './email-notification-sender';
export { WhatsappNotificationSender } from './whatsapp-notification-sender';
export { SMSNotificationSender } from './sms-notification-sender';

export { Notifier, NotificationDeliveryError } from './notifier';

export { NotificationModule } from './notification.module';
export type { NotificationModuleConfig } from './notification.module';

export {
  NOTIFICATION_CHANNEL_CONFIG_DATA,
  NOTIFICATION_CHANNEL_CONFIG,
  EMAIL_TEMPLATE_DATA,
  EMAIL_TEMPLATE_REPOSITORY,
  SMS_TEMPLATE_DATA,
  SMS_TEMPLATE_REPOSITORY,
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFIER,
} from './tokens';
