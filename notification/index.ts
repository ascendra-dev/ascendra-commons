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

export type {
  EmailProviderConfig,
  SmsProviderConfig,
  WhatsappProviderConfig,
  ProviderConfigResolver,
} from './notification-provider-config';
export { StaticProviderConfigResolver } from './notification-provider-config';

export type { UserContactResolver } from './user-contact-resolver';
export { NullUserContactResolver } from './user-contact-resolver';

export { Notifier, NotificationDeliveryError } from './notifier';

export { NotificationModule } from './notification.module';
export type { NotificationModuleConfig } from './notification.module';

export {
  USER_CONTACT_RESOLVER,
  NOTIFICATION_CHANNEL_CONFIG_DATA,
  NOTIFICATION_CHANNEL_CONFIG,
  EMAIL_TEMPLATE_DATA,
  EMAIL_TEMPLATE_REPOSITORY,
  SMS_TEMPLATE_DATA,
  SMS_TEMPLATE_REPOSITORY,
  EMAIL_PROVIDER_CONFIG_DATA,
  EMAIL_PROVIDER_CONFIG,
  SMS_PROVIDER_CONFIG_DATA,
  SMS_PROVIDER_CONFIG,
  WHATSAPP_PROVIDER_CONFIG_DATA,
  WHATSAPP_PROVIDER_CONFIG,
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFIER,
} from './tokens';
