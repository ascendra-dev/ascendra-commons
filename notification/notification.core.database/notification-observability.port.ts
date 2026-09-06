import type {
  CoverageGap,
  DeliveryContentRecord,
  DeliveryHistoryPage,
  DeliveryHistoryQuery,
} from './notification-admin.types';

/**
 * Read-only reporting for a notification admin screen — the delivery log and
 * gaps in the routing/template/credential config. Bound under
 * `NOTIFICATION_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `notification.api`. Never mutates.
 */
export interface NotificationObservabilityPort {
  /** Delivery attempts, newest first, keyset-paginated. */
  getDeliveryHistory(query?: DeliveryHistoryQuery): Promise<DeliveryHistoryPage>;
  /** The stored rendered content for one row — `null` when the row doesn't exist or `storeContent` was off. */
  getDeliveryContent(id: string): Promise<DeliveryContentRecord | null>;
  /** For every routed (notificationType, tenant, channel): is there a usable template, and (for a tenant route) a credential? */
  configCoverageGaps(): Promise<CoverageGap[]>;
}
