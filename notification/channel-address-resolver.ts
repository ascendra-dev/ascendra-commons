import { Inject, Injectable } from '@nestjs/common';
import { NotificationRecipient } from './notifier';
import { USER_CONTACT_RESOLVER } from './tokens';

/**
 * Resolves contact info for a 'user' recipient. A consuming project implements
 * this against its own actual user/issuer/staff table — this library has no
 * opinion on that schema. Returns both fields regardless of which channel is
 * asking; each ChannelAddressResolver below picks the one it needs.
 */
export interface UserContactResolver {
  findById(id: string): Promise<{ email?: string; phone?: string } | null>;
}

/** How a channel gets its own address out of a recipient — one implementation per address type, not per channel. */
export interface ChannelAddressResolver {
  resolve(recipient: NotificationRecipient): Promise<string | null>;
}

@Injectable()
export class EmailAddressResolver implements ChannelAddressResolver {
  constructor(@Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver) {}

  async resolve(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type === 'raw') return recipient.email ?? null;
    const user = await this.users.findById(recipient.id);
    return user?.email ?? null;
  }
}

/** Shared by whatsapp and sms — both address by phone number, just delivered differently. */
@Injectable()
export class PhoneAddressResolver implements ChannelAddressResolver {
  constructor(@Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver) {}

  async resolve(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type === 'raw') return recipient.phone ?? null;
    const user = await this.users.findById(recipient.id);
    return user?.phone ?? null;
  }
}
