export type {
  NotificationRecipient,
  NotificationRequest,
  NotificationResult,
  NotificationChannel,
  NotificationChannelResult,
  Notifier,
} from './notifier';

export type { NotificationTemplate, NotificationTemplateRepository } from './notification-template';
export { renderTemplate } from './notification-template';

export type { NotificationLogEntry, NotificationLogStore } from './notification-log-store';
export { InMemoryNotificationLogStore } from './notification-log-store';

export type { UserContactResolver, ChannelAddressResolver } from './channel-address-resolver';
export { EmailAddressResolver, PhoneAddressResolver } from './channel-address-resolver';

export type { RenderedMessage, ChannelTransport, EmailClient } from './channel-transport';
export { LogChannelTransport, EmailChannelTransport } from './channel-transport';

export { ChannelNotifier } from './channel-notifier';

export type { NotifierChannelPolicy, NotifierChannelConfig } from './notifier-channel-policy';
export { StaticNotifierChannelPolicy } from './notifier-channel-policy';

export { NotifierRouter } from './notifier-router';

export {
  USER_CONTACT_RESOLVER,
  EMAIL_CLIENT,
  NOTIFICATION_LOG_STORE,
  EMAIL_TEMPLATE_REPOSITORY,
  WHATSAPP_TEMPLATE_REPOSITORY,
  SMS_TEMPLATE_REPOSITORY,
  NOTIFIER_CHANNEL_POLICY,
  NOTIFIER_CHANNEL_CONFIG,
  NOTIFIER_CHANNELS,
  NOTIFIER,
} from './tokens';
