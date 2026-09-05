import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannelResult, NotificationRecipient, NotificationRequest } from './notification.types';
import { NotificationSender } from './notification-sender';
import { NotificationTemplateRepository, renderTemplate } from './notification-template';
import { UserContactResolver } from './user-contact-resolver';
import { EmailProviderConfig, ProviderConfigResolver } from './notification-provider-config';
import { EMAIL_PROVIDER_CONFIG, EMAIL_TEMPLATE_REPOSITORY, USER_CONTACT_RESOLVER } from './tokens';

@Injectable()
export class EmailNotificationSender implements NotificationSender {
  constructor(
    @Inject(EMAIL_TEMPLATE_REPOSITORY) private readonly templates: NotificationTemplateRepository,
    @Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver,
    @Inject(EMAIL_PROVIDER_CONFIG) private readonly providerConfig: ProviderConfigResolver<EmailProviderConfig>,
  ) {}

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const to = await this.resolveEmail(request.recipient);
    if (!to) return { status: 'failed', reason: 'no_address_available' };

    const config = await this.providerConfig.configFor(request.tenantId ?? null);
    if (!config) return { status: 'failed', reason: 'no_provider_config' };

    const template = await this.templates.templateFor(request.notificationType, request.tenantId ?? null);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    console.log('email', { from: config.fromAddress, to, ...rendered });
    return { status: 'sent' };
  }

  private async resolveEmail(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type === 'raw') return recipient.email ?? null;
    const user = await this.users.findById(recipient.id);
    return user?.email ?? null;
  }
}
