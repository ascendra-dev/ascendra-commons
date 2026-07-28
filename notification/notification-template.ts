export interface NotificationTemplate {
  eventType: string;
  subject: string;
  body: string;
}

/**
 * Templates are data, not code: a lookup by eventType, so adding a new event type
 * is a data row in the consuming project's own store, not a code change here.
 */
export interface NotificationTemplateRepository {
  findByEventType(eventType: string): Promise<NotificationTemplate | null>;
}

/**
 * Missing variables are left as visible, unresolved {{placeholders}} rather than
 * silently blanked — a blank subject/body reads as "working," a visible
 * placeholder is obviously wrong and gets noticed before it reaches a user.
 */
export function renderTemplate(
  template: NotificationTemplate,
  variables: Record<string, string | number>,
): { subject: string; body: string } {
  const interpolate = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      const value = variables[key];
      return value === undefined ? match : String(value);
    });

  return { subject: interpolate(template.subject), body: interpolate(template.body) };
}
