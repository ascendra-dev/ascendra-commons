// Stack-agnostic utilities
export { ConfigCache } from './config-cache';
export { encodeKeysetCursor, decodeKeysetCursor } from './keyset-cursor';

// Ports a stack adapter implements
export type { NotificationObservabilityPort } from './notification-observability.port';
export type { NotificationConfigAdminPort } from './notification-config-admin.port';

// Answer-shapes / write inputs
export type {
  DeliveryRecord,
  DeliveryContentRecord,
  DeliveryHistoryQuery,
  DeliveryHistoryPage,
  DeliveryStatsQuery,
  DeliveryStats,
  DeliveryChannelStatusCount,
  DeliveryTypeStatusCount,
  DeliveryDayCount,
  CoverageGap,
  ChannelRouteView,
  TemplateView,
  ProviderCredentialView,
  SetChannelRouteInput,
  DeleteChannelRouteInput,
  SetTemplateInput,
  DeleteTemplateInput,
  SetProviderCredentialInput,
  DeleteProviderCredentialInput,
} from './notification-admin.types';

export { NOTIFICATION_OBSERVABILITY_PORT, NOTIFICATION_CONFIG_ADMIN_PORT } from './tokens';
