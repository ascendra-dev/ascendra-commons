import type {
  NotificationConfig,
  NotificationConfigData,
  ProviderConfig,
} from '../notification.core';
import type { NotificationChannel, NotificationTemplate } from '../notification.core';

/**
 * Model 1 — everything from an in-memory object.
 *
 * The per-method `tenantId` treatment is a **deliberate asymmetry**, not an
 * oversight — it turns on whether per-tenant is the *normal* shape or an
 * *eventual divergence*:
 *
 * - `channelsFor` / `templateFor` **ignore** `tenantId`: one routing config and
 *   one template set for the whole deployment. Per-tenant routing or
 *   white-labeled content is the signal to move to Model 2
 *   (`notification.core.database`), which resolves a tenant-specific row first,
 *   falling through to the deployment default.
 * - `providerConfigFor` **honors** `tenantId`: "one tenant, one provider
 *   account" is the normal shape from day one. A `null` tenantId resolves to
 *   `null` (fails closed), never a deployment-wide fallback.
 *
 * To go database-backed for one method only, `extends` this and override it —
 * the other methods keep serving the static data passed to `super()`.
 */
export class StaticNotificationConfig implements NotificationConfig {
  constructor(private readonly data: NotificationConfigData) {}

  async channelsFor(notificationType: string, _tenantId: string | null): Promise<NotificationChannel[]> {
    return this.data.channels[notificationType] ?? []; // deployment-wide — see the class doc for why `_tenantId` is unused
  }

  async templateFor(
    channel: NotificationChannel,
    notificationType: string,
    _tenantId: string | null,
  ): Promise<NotificationTemplate | null> {
    return this.data.templates?.[channel]?.[notificationType] ?? null; // deployment-wide — see the class doc
  }

  async providerConfigFor(channel: NotificationChannel, tenantId: string | null): Promise<ProviderConfig | null> {
    if (tenantId === null) return null;
    return this.data.providerConfigs?.[channel]?.[tenantId] ?? null;
  }
}
