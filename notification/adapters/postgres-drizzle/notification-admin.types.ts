import type { NotificationChannel } from '../../notification.types';

/** One `commons_notification_delivery` row, typed for a UI. */
export interface DeliveryRecord {
  id: string;
  notificationType: string;
  channel: NotificationChannel;
  tenantId: string | null;
  recipientRef: string;
  status: 'sent' | 'failed' | 'delivered' | 'bounced';
  reason: string | null;
  providerMessageId: string | null;
  attemptedAt: Date;
  updatedAt: Date;
  correlationId: string | null;
}

export interface DeliveryHistoryQuery {
  notificationType?: string;
  channel?: NotificationChannel;
  tenantId?: string;
  /** e.g. `'user:abc123'`. */
  recipientRef?: string;
  status?: DeliveryRecord['status'];
  /** Join to the same id in audit / job-run history for a cross-module trace. */
  correlationId?: string;
  since?: Date;
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  cursor?: string;
}

export interface DeliveryHistoryPage {
  deliveries: DeliveryRecord[];
  nextCursor?: string;
}

/** A hole in the routing/template/credential config, for a "config health" panel. */
export interface CoverageGap {
  notificationType: string;
  tenantId: string | null;
  channel: NotificationChannel;
  kind: 'missing_template' | 'missing_provider_credential';
}

export interface ChannelRouteView {
  notificationType: string;
  tenantId: string | null;
  channels: NotificationChannel[];
}

export interface TemplateView {
  channel: NotificationChannel;
  notificationType: string;
  tenantId: string | null;
  subject: string | null;
  body: string;
  isHtml: boolean;
}

/** Credentials are never returned — only which (channel, tenant) pairs have one. */
export interface ProviderCredentialView {
  channel: NotificationChannel;
  tenantId: string;
}
