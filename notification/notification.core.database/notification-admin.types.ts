import type { DeliveryContent, NotificationChannel } from '../notification.core';

/**
 * The answer-shapes for the notification admin/observability surface — what
 * every stack adapter returns and `notification.api` serves. Stack-agnostic
 * (no SQL, no ORM types). Moved here from the Postgres adapter so a second
 * stack adapter shares them.
 */

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
  /** Whether the rendered `content` was stored for this row (the recorder's `storeContent`). */
  hasContent: boolean;
}

/** One row's stored rendered content — from `getDeliveryContent(id)`, null when not stored. */
export interface DeliveryContentRecord {
  id: string;
  notificationType: string;
  channel: NotificationChannel;
  recipientRef: string;
  attemptedAt: Date;
  content: DeliveryContent;
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

export interface DeliveryStatsQuery {
  tenantId?: string;
  /** Inclusive start of the window. Defaults to 7 days before `until`. */
  since?: Date;
  /** Exclusive end of the window. Defaults to now. */
  until?: Date;
}

export interface DeliveryChannelStatusCount {
  channel: NotificationChannel;
  status: DeliveryRecord['status'];
  count: number;
}

export interface DeliveryTypeStatusCount {
  notificationType: string;
  status: DeliveryRecord['status'];
  count: number;
}

export interface DeliveryDayCount {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  count: number;
}

/** `GET /notifications/stats` — send volume grouped a few ways over one window. */
export interface DeliveryStats {
  since: Date;
  until: Date;
  byChannel: DeliveryChannelStatusCount[];
  byType: DeliveryTypeStatusCount[];
  byDay: DeliveryDayCount[];
}

/** A hole in the routing/template/credential config, for a "config health" panel. */
export interface CoverageGap {
  notificationType: string;
  tenantId: string | null;
  channel: NotificationChannel;
  kind: 'missing_template' | 'missing_provider_credential';
}

/**
 * Whose configuration a read covers: `{ tenantId }` = the deployment defaults (`tenant_id` NULL) plus that tenant's own
 * rows — what a tenant admin may see; omitted = every row (a platform admin). Credentials have no default rows to show.
 */
export interface ConfigScope {
  tenantId: string;
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

// ---- write inputs ----

export interface SetChannelRouteInput {
  notificationType: string;
  tenantId: string | null;
  channels: NotificationChannel[];
}

export interface DeleteChannelRouteInput {
  notificationType: string;
  tenantId: string | null;
}

export interface SetTemplateInput {
  channel: NotificationChannel;
  notificationType: string;
  tenantId: string | null;
  subject?: string | null;
  body: string;
  isHtml?: boolean;
}

export interface DeleteTemplateInput {
  channel: NotificationChannel;
  notificationType: string;
  tenantId: string | null;
}

export interface SetProviderCredentialInput {
  channel: NotificationChannel;
  tenantId: string;
  config: Record<string, unknown>;
}

export interface DeleteProviderCredentialInput {
  channel: NotificationChannel;
  tenantId: string;
}
