export type { NotificationRecipient, NotificationRequest, NotificationResult, NotificationSender } from './notification.types';
export type { NotificationTemplate, NotificationTemplateRepository } from './notification-template';
export { renderTemplate } from './notification-template';
export type { NotificationLogEntry, NotificationLogStore } from './notification-log-store';
export { InMemoryNotificationLogStore } from './notification-log-store';
export { LogNotificationSender } from './log-notification-sender';
export type { EmailClient, UserContactResolver } from './email-notification-sender';
export { EmailNotificationSender } from './email-notification-sender';
export { NotificationModule } from './notification.module';
export {
  NOTIFICATION_TEMPLATE_REPOSITORY,
  NOTIFICATION_LOG_STORE,
  EMAIL_CLIENT,
  USER_CONTACT_RESOLVER,
  NOTIFICATION_SENDER,
} from './tokens';
