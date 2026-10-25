import type {
  ConfigScope,
  CoverageGap,
  DeliveryContentRecord,
  DeliveryHistoryPage,
  DeliveryHistoryQuery,
  DeliveryRecord,
  DeliveryStats,
  DeliveryStatsQuery,
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
  /** One delivery row's metadata (no content) — `null` when the row doesn't exist. */
  getDelivery(id: string): Promise<DeliveryRecord | null>;
  /** The stored rendered content for one row — `null` when the row doesn't exist or `storeContent` was off. */
  getDeliveryContent(id: string): Promise<DeliveryContentRecord | null>;
  /** For every routed (notificationType, tenant, channel): is there a usable template, and (for a tenant route) a credential? */
  configCoverageGaps(scope?: ConfigScope): Promise<CoverageGap[]>;
  /** Send volume grouped by channel/status, type/status and day, over one window. */
  getDeliveryStats(query?: DeliveryStatsQuery): Promise<DeliveryStats>;
}
