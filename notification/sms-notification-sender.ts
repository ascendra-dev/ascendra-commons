import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannelResult, NotificationRecipient, NotificationRequest } from './notification.types';
import { NotificationSender } from './notification-sender';
import { NotificationTemplateRepository, renderTemplate } from './notification-template';
import { UserContactResolver } from './user-contact-resolver';
import { SMS_TEMPLATE_REPOSITORY, USER_CONTACT_RESOLVER } from './tokens';

@Injectable()
export class SMSNotificationSender implements NotificationSender {
  constructor(
    @Inject(SMS_TEMPLATE_REPOSITORY) private readonly templates: NotificationTemplateRepository,
    @Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver,
  ) {}

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const to = await this.resolvePhone(request.recipient);
    if (!to) return { status: 'failed', reason: 'no_address_available' };

    const template = await this.templates.templateFor(request.notificationType);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    console.log('sms', { to, ...rendered });
    return { status: 'sent' };
  }

  private async resolvePhone(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type === 'raw') return recipient.phone ?? null;
    const user = await this.users.findById(recipient.id);
    return user?.phone ?? null;
  }
}
