import type { NotificationChannel } from '../../notification.core';
import type { DeliveryRecord } from '../../notification.core.database';

/**
 * Request shapes for `notification.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. Controllers apply light structural checks; the
 * `.api` services apply the actor-scoped rules.
 */

export interface DeliveryHistoryQueryDto {
  notificationType?: string;
  channel?: NotificationChannel;
  tenantId?: string;
  recipientRef?: string;
  status?: DeliveryRecord['status'];
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

export interface SetChannelRouteBody {
  notificationType: string;
  /** `null` = deployment default (platform admin only). */
  tenantId: string | null;
  channels: NotificationChannel[];
}

export interface DeleteChannelRouteBody {
  notificationType: string;
  tenantId: string | null;
}

export interface SetTemplateBody {
  channel: NotificationChannel;
  notificationType: string;
  tenantId: string | null;
  subject?: string | null;
  body: string;
  isHtml?: boolean;
}

export interface DeleteTemplateBody {
  channel: NotificationChannel;
  notificationType: string;
  tenantId: string | null;
}

export interface SetProviderCredentialBody {
  channel: NotificationChannel;
  /** Credentials are always per-tenant — never null. */
  tenantId: string;
  config: Record<string, unknown>;
}

export interface DeleteProviderCredentialBody {
  channel: NotificationChannel;
  tenantId: string;
}

export interface TestSendBody {
  recipient: { type: 'user'; id: string } | { type: 'raw'; email?: string; phone?: string };
  notificationType: string;
  variables?: Record<string, string | number>;
  /** Omit to use the caller's own tenant; if given it must equal the caller's tenant (unless platform admin). */
  tenantId?: string | null;
}
