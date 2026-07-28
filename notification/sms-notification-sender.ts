import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannelResult, NotificationRequest } from './notification.types';
import { NotificationSender } from './notification-sender';
import { NotificationTemplateRepository, renderTemplate } from './notification-template';
import { SMS_TEMPLATE_REPOSITORY } from './tokens';

@Injectable()
export class SMSNotificationSender implements NotificationSender {
  constructor(@Inject(SMS_TEMPLATE_REPOSITORY) private readonly templates: NotificationTemplateRepository) {}

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const template = await this.templates.templateFor(request.notificationType);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    console.log('sms', rendered);
    return { status: 'sent' };
  }
}
