/**
 * A template for one notificationType, within one channel's own repository.
 * subject and isHtml are email-only — SMS's own templates just leave them
 * unset, since SMS has no subject line and no HTML concept. WhatsApp does not
 * use this shape at all: its templates are pre-approved and named on Meta's
 * side, with positional numbered parameters, not text this library renders —
 * that's a separate shape for a later piece.
 */
export interface NotificationTemplate {
  subject?: string;
  body: string;
  isHtml?: boolean;
}

/**
 * An interface — same reasoning as NotificationChannelConfig: static and
 * database-backed implementations share no behavior with each other.
 */
export interface NotificationTemplateRepository {
  /**
   * `tenantId` is `request.tenantId ?? null` — always passed, so a
   * database-backed implementation can serve a tenant-specific (e.g.
   * white-labeled) template in place of the deployment default.
   * `StaticNotificationTemplateRepository` receives it and ignores it — same
   * reasoning as `StaticNotificationChannelConfig.channelsFor()`.
   */
  templateFor(notificationType: string, tenantId: string | null): Promise<NotificationTemplate | null>;
}

/**
 * Which text a notificationType uses for one channel — data, not code. Each
 * channel gets its own instance (see NotificationModule) even though both
 * email and SMS use this same class, since each channel maintains its own
 * templates. Same reasoning as StaticNotificationChannelConfig for why this
 * lives here and a database-backed implementation would live in the
 * consuming project instead.
 *
 * Not decorated @Injectable() with a fixed @Inject() token: two differently
 * configured instances of this class are needed (email's templates, SMS's
 * templates), which a single fixed provider registration can't produce — see
 * NotificationModule's useFactory bindings for EMAIL_TEMPLATE_REPOSITORY and
 * SMS_TEMPLATE_REPOSITORY.
 */
export class StaticNotificationTemplateRepository implements NotificationTemplateRepository {
  constructor(private readonly templates: Record<string, NotificationTemplate>) {}

  async templateFor(notificationType: string, _tenantId: string | null): Promise<NotificationTemplate | null> {
    return this.templates[notificationType] ?? null;
  }
}

/**
 * Missing variables are left as visible, unresolved {{placeholders}} rather
 * than silently blanked — a blank subject/body reads as "working," a visible
 * placeholder is obviously wrong and gets noticed before it reaches a user.
 */
export function renderTemplate(
  template: NotificationTemplate,
  variables: Record<string, string | number>,
): { subject?: string; body: string; isHtml?: boolean } {
  const interpolate = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      const value = variables[key];
      return value === undefined ? match : String(value);
    });

  return {
    subject: template.subject ? interpolate(template.subject) : undefined,
    body: interpolate(template.body),
    isHtml: template.isHtml,
  };
}
