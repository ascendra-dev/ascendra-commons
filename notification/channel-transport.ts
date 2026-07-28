import { Inject, Injectable } from '@nestjs/common';
import { NOTIFICATION_LOG_STORE, EMAIL_CLIENT } from './tokens';
import { NotificationLogStore } from './notification-log-store';

export interface RenderedMessage {
  subject?: string;
  body: string;
}

/**
 * The one thing that's genuinely a stub today and swappable independently of
 * everything else — resolving an address, looking up a template, and rendering
 * it are all real regardless of which transport a channel is bound to.
 */
export interface ChannelTransport {
  deliver(params: { to: string; message: RenderedMessage }): Promise<void>;
}

/**
 * The Model 1 stub for any channel. Every channel (email, whatsapp, sms) can be
 * bound to this transport today — swapping one channel to real delivery later
 * is exactly one binding change, to this token alone, for that channel only.
 */
@Injectable()
export class LogChannelTransport implements ChannelTransport {
  constructor(@Inject(NOTIFICATION_LOG_STORE) private readonly store: NotificationLogStore) {}

  async deliver(params: { to: string; message: RenderedMessage }): Promise<void> {
    await this.store.record({ to: params.to, message: params.message, recordedAt: new Date() });
  }
}

/** Thin wrapper over whatever provider a consuming project actually uses (Resend, SES, ...). */
export interface EmailClient {
  send(params: { to: string; subject: string; body: string }): Promise<void>;
}

/** The one real transport built so far — shown alongside the stub as a worked example of "swap this one binding." */
@Injectable()
export class EmailChannelTransport implements ChannelTransport {
  constructor(@Inject(EMAIL_CLIENT) private readonly emailClient: EmailClient) {}

  async deliver(params: { to: string; message: RenderedMessage }): Promise<void> {
    await this.emailClient.send({ to: params.to, subject: params.message.subject ?? '', body: params.message.body });
  }
}
