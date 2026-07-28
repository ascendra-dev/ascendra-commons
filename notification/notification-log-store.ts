import { Injectable } from '@nestjs/common';
import { NotificationRecipient } from './notification.types';

export interface NotificationLogEntry {
  recipient: NotificationRecipient;
  eventType: string;
  variables: Record<string, string | number>;
  recordedAt: Date;
}

export interface NotificationLogStore {
  record(entry: NotificationLogEntry): Promise<void>;
}

/**
 * A real, working, zero-external-dependency default — suitable for a project's
 * very first stage, or for tests. A consuming project that wants persistence
 * across restarts implements NotificationLogStore against its own DB and binds
 * that instead; nothing about LogNotificationSender changes either way.
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
