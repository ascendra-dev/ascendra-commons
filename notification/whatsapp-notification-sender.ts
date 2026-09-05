import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannelResult, NotificationRequest } from './notification.types';
import { NotificationSender } from './notification-sender';
import { ProviderConfigResolver, WhatsappProviderConfig } from './notification-provider-config';
import { WHATSAPP_PROVIDER_CONFIG } from './tokens';

/**
 * No template repository yet — WhatsApp's real templates are pre-approved and
 * named on Meta's side with positional numbered parameters, not text this
 * library renders the way email/SMS templates work. That's a distinct shape
 * for a later piece; this stays a stub until it's built. Provider config is
 * wired in now regardless — the credential-per-tenant seam doesn't depend on
 * the template shape being resolved first.
 */
@Injectable()
export class WhatsappNotificationSender implements NotificationSender {
  constructor(
    @Inject(WHATSAPP_PROVIDER_CONFIG) private readonly providerConfig: ProviderConfigResolver<WhatsappProviderConfig>,
  ) {}

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const config = await this.providerConfig.configFor(request.tenantId ?? null);
    if (!config) return { status: 'failed', reason: 'no_provider_config' };

    console.log('whatsapp', { from: config.fromNumber, ...request });
    return { status: 'sent' };
  }
}
