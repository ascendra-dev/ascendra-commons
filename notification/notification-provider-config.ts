/**
 * What EmailNotificationSender needs to actually authenticate with a real
 * provider — deliberately provider-agnostic field names (not SendGrid's,
 * Postmark's, or SES's own shape) so this library doesn't lock a consumer
 * into one vendor. A consumer's real HTTP call maps these onto whichever
 * provider they pick.
 */
export interface EmailProviderConfig {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
}

/** Same reasoning as EmailProviderConfig — provider-agnostic, not Twilio's/Vonage's own shape. */
export interface SmsProviderConfig {
  apiKey: string;
  fromNumber: string;
}

/** Same reasoning again. WhatsApp's `fromNumber` is whatever sender identity the eventual real provider binding uses (a phone number id, a business account id, ...) — this stays a stub until WhatsappNotificationSender itself is real (see this module's README). */
export interface WhatsappProviderConfig {
  apiKey: string;
  fromNumber: string;
}

/**
 * An interface, not a class — same reasoning as NotificationChannelConfig and
 * NotificationTemplateRepository: static and database-backed implementations
 * share no behavior with each other. Reused across all three channels via
 * TConfig, the same way NotificationTemplateRepository is reused for both
 * email and SMS via separate tokens/instances rather than three near-identical
 * interfaces.
 */
export interface ProviderConfigResolver<TConfig> {
  configFor(tenantId: string | null): Promise<TConfig | null>;
}

/**
 * The Model 1 implementation — genuinely branches on tenantId, unlike
 * StaticNotificationChannelConfig/StaticNotificationTemplateRepository, which
 * ignore it by design (one deployment-wide config until a tenant needs to
 * differ). Provider credentials are the opposite case: "by tenantId" is the
 * actual ask (see this module's README) — a tenant with their own SendGrid/
 * Twilio account is the normal case, not the exceptional one a database-backed
 * override exists to handle. A tenantId of null (a platform-wide notification
 * with no single tenant) has no credentials to look up here and resolves to
 * null, same as an unconfigured tenantId — fails closed and visibly, the same
 * as every other unconfigured lookup in this module.
 */
export class StaticProviderConfigResolver<TConfig> implements ProviderConfigResolver<TConfig> {
  constructor(private readonly configs: Record<string, TConfig>) {}

  async configFor(tenantId: string | null): Promise<TConfig | null> {
    if (tenantId === null) return null;
    return this.configs[tenantId] ?? null;
  }
}
