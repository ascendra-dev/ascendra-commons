import { Inject, Injectable } from '@nestjs/common';
import { NotificationRecipient, NotificationRequest, NotificationResult, NotificationSender } from './notification.types';
import { NotificationTemplateRepository, renderTemplate } from './notification-template';
import { EMAIL_CLIENT, NOTIFICATION_TEMPLATE_REPOSITORY, USER_CONTACT_RESOLVER } from './tokens';

/** Thin wrapper over whatever provider a consuming project actually uses (Resend, SES, ...). */
export interface EmailClient {
  send(params: { to: string; subject: string; body: string }): Promise<void>;
}

/**
 * Resolves contact info for a 'user' recipient. A consuming project implements
 * this against its own actual user/issuer/staff table — this library has no
 * opinion on that schema.
 */
export interface UserContactResolver {
  findById(id: string): Promise<{ email?: string; phone?: string } | null>;
}

/**
 * One real email channel, no template-management UI, no SMS/WhatsApp/push. Build
 * a NotificationRouter satisfying the same NotificationSender interface only once
 * a specific story needs a second channel — see the module README's Model 2.
 */
@Injectable()
export class EmailNotificationSender implements NotificationSender {
  constructor(
    @Inject(NOTIFICATION_TEMPLATE_REPOSITORY) private readonly templates: NotificationTemplateRepository,
    @Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver,
    @Inject(EMAIL_CLIENT) private readonly emailClient: EmailClient,
  ) {}

  async send(request: NotificationRequest): Promise<NotificationResult> {
    const email = await this.resolveEmail(request.recipient);
    if (!email) return { status: 'failed', reason: 'no_email_available' };

    const template = await this.templates.findByEventType(request.eventType);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    try {
      await this.emailClient.send({ to: email, subject: rendered.subject, body: rendered.body });
      return { status: 'sent' };
    } catch (err) {
      // Never throws to the caller — this is the best-effort contract the
      // domain-events pattern's emit() (and a well-behaved listener) rely on.
      return { status: 'failed', reason: err instanceof Error ? err.message : 'unknown_error' };
    }
  }

  private async resolveEmail(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type === 'raw') return recipient.email ?? null;
    const user = await this.users.findById(recipient.id);
    return user?.email ?? null;
  }
}
