import { Notifier, NotificationRequest, NotificationResult } from './notifier';
import { ChannelAddressResolver } from './channel-address-resolver';
import { NotificationTemplateRepository, renderTemplate } from './notification-template';
import { ChannelTransport } from './channel-transport';

/**
 * One generic Notifier implementation, configured per channel by which address
 * resolver, template repository, and transport it's given. Email, WhatsApp, and
 * SMS are all just different configurations of this same class, not three
 * separate implementations — see notifier-router.ts for how a set of these
 * gets composed into "the configured channels for this event type."
 *
 * Not itself decorated @Injectable() with token-based constructor params —
 * three differently-configured instances of the same class can't come from one
 * fixed provider registration. Each channel's instance is built via a
 * useFactory in the consumer's own module (see this folder's README).
 */
export class ChannelNotifier implements Notifier {
  constructor(
    private readonly addressResolver: ChannelAddressResolver,
    private readonly templates: NotificationTemplateRepository,
    private readonly transport: ChannelTransport,
  ) {}

  async notify(request: NotificationRequest): Promise<NotificationResult> {
    const address = await this.addressResolver.resolve(request.recipient);
    if (!address) return { status: 'failed', reason: 'no_address_available' };

    const template = await this.templates.findByEventType(request.eventType);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);

    try {
      await this.transport.deliver({ to: address, message: rendered });
      return { status: 'sent' };
    } catch (err) {
      // Never throws to the caller — this is the contract every Notifier keeps.
      return { status: 'failed', reason: err instanceof Error ? err.message : 'unknown_error' };
    }
  }
}
