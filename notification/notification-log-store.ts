import { Injectable } from '@nestjs/common';
import { RenderedMessage } from './channel-transport';

export interface NotificationLogEntry {
  to: string;
  message: RenderedMessage;
  recordedAt: Date;
}

export interface NotificationLogStore {
  record(entry: NotificationLogEntry): Promise<void>;
}

/**
 * A real, working, zero-external-dependency default — suitable for a project's
 * very first stage, or for tests. Records the actual rendered message, not the
 * raw request — since template lookup/rendering already happened by the time
 * LogChannelTransport calls this, this is what actually confirms a channel's
 * templates render correctly, even before that channel has a real provider.
 */
@Injectable()
export class InMemoryNotificationLogStore implements NotificationLogStore {
  private readonly entries: NotificationLogEntry[] = [];

  async record(entry: NotificationLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  list(): readonly NotificationLogEntry[] {
    return this.entries;
  }
}
