import { NotificationChannel } from './notification.types';
import { NotificationTemplate } from './notification-template';

/**
 * Provider-agnostic delivery credentials for one channel, for one tenant.
 * `from` is the sender identity — an address for email, a number/sender id for
 * SMS/WhatsApp. Field names are not any vendor's own shape (SendGrid/Twilio/
 * Meta) — this library ships the seam, a consumer's real delivery call maps
 * these onto whichever provider they pick.
 */
export interface ProviderConfig {
  apiKey: string;
  from: string;
  fromName?: string;
}

/**
 * The one configuration surface a consumer supplies: channel routing,
 * per-channel templates, per-channel delivery credentials. One interface, one
 * token (`NOTIFICATION_CONFIG`) — replacing what used to be four single-method
 * interfaces spread across seven provider slots.
 *
 * `tenantId` is `request.tenantId ?? null` — always passed, never optional, so
 * every implementation consciously receives tenant context rather than
 * silently ignoring it by omission. `StaticNotificationConfig` ignores it for
 * `channelsFor`/`templateFor` (one config for the whole deployment) and honors
 * it for `providerConfigFor` (one tenant, one provider account) — see its own
 * doc comment.
 *
 * `channelsFor` returns which channels a notificationType uses; `templateFor`
 * and `providerConfigFor` take the channel as a parameter (the calling sender
 * always knows its own).
 */
export interface NotificationConfig {
  channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]>;
  templateFor(
    channel: NotificationChannel,
    notificationType: string,
    tenantId: string | null,
  ): Promise<NotificationTemplate | null>;
  providerConfigFor(channel: NotificationChannel, tenantId: string | null): Promise<ProviderConfig | null>;
}

/** The in-memory data `StaticNotificationConfig` reads. Only `channels` is required. */
export interface NotificationConfigData {
  /** notificationType -> channel(s). An unconfigured type resolves to zero channels — fails closed. */
  channels: Record<string, NotificationChannel[]>;
  /** channel -> (notificationType -> template). A missing entry is a per-send `template_not_found`. */
  templates?: Partial<Record<NotificationChannel, Record<string, NotificationTemplate>>>;
  /** channel -> (tenantId -> credentials). A missing entry is a per-send `no_provider_config`. */
  providerConfigs?: Partial<Record<NotificationChannel, Record<string, ProviderConfig>>>;
}

/**
 * Model 1 — everything from an in-memory object.
 *
 * The per-method `tenantId` treatment is a **deliberate asymmetry**, not an
 * oversight — it turns on whether per-tenant is the *normal* shape or an
 * *eventual divergence*:
 *
 * - `channelsFor` / `templateFor` **ignore** `tenantId`: one routing config and
 *   one template set for the whole deployment. Per-tenant routing or
 *   white-labeled content is an eventual divergence — when a tenant needs it,
 *   that's the signal to go `model: 'database'` (the DB-backed `NotificationConfig`
 *   resolves a tenant-specific row first, falling through to the deployment
 *   default — see the module README). Same Model 1/Model 2 split `authorization`
 *   makes for personas: the static authorizer has one persona map for the
 *   deployment, not per-tenant.
 * - `providerConfigFor` **honors** `tenantId`: "one tenant, one provider
 *   account" is the normal shape from day one — a tenant bringing their own
 *   SendGrid/Twilio account isn't a scaling exception, it's the point. A `null`
 *   tenantId has nothing to look up and resolves to `null` (fails closed),
 *   never a deployment-wide fallback.
 *
 * To go database-backed for one method only, `extends` this and override it —
 * the other methods keep serving the static data passed to `super()`:
 *
 * ```typescript
 * class MyConfig extends StaticNotificationConfig {
 *   constructor(private readonly db: Db) { super({ channels: {...}, templates: {...} }); }
 *   async channelsFor(type, tenantId) { return this.db.channelsFor(type, tenantId); }
 * }
 * ```
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
