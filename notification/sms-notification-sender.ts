import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannelResult, NotificationRecipient, NotificationRequest } from './notification.types';
import { NotificationSender } from './notification-sender';
import { NotificationTemplateRepository, renderTemplate } from './notification-template';
import { UserContactResolver } from './user-contact-resolver';
import { ProviderConfigResolver, SmsProviderConfig } from './notification-provider-config';
import { SMS_PROVIDER_CONFIG, SMS_TEMPLATE_REPOSITORY, USER_CONTACT_RESOLVER } from './tokens';

@Injectable()
export class SMSNotificationSender implements NotificationSender {
  constructor(
    @Inject(SMS_TEMPLATE_REPOSITORY) private readonly templates: NotificationTemplateRepository,
    @Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver,
    @Inject(SMS_PROVIDER_CONFIG) private readonly providerConfig: ProviderConfigResolver<SmsProviderConfig>,
  ) {}

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const to = await this.resolvePhone(request.recipient);
    if (!to) return { status: 'failed', reason: 'no_address_available' };

    const config = await this.providerConfig.configFor(request.tenantId ?? null);
    if (!config) return { status: 'failed', reason: 'no_provider_config' };

    const template = await this.templates.templateFor(request.notificationType, request.tenantId ?? null);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    console.log('sms', { from: config.fromNumber, to, ...rendered });
    return { status: 'sent' };
  }

  private async resolvePhone(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type === 'raw') return recipient.phone ?? null;
    const user = await this.users.findById(recipient.id);
    return user?.phone ?? null;
  }
}
