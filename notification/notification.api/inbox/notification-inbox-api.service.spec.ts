import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationInboxApiService } from './notification-inbox-api.service';
import { InvalidDeliveryCursorError, type NotificationInboxStore } from '../../notification.core.database';
import type { Actor } from '../../../authorization/authorization.core';

const actor: Actor = { id: 'u1', persona: 'member', tenantId: 't1' };
const store = (): NotificationInboxStore => ({
  list: vi.fn().mockResolvedValue({ items: [] }),
  unreadCount: vi.fn().mockResolvedValue(3),
  markRead: vi.fn().mockResolvedValue(false),
  markAllRead: vi.fn().mockResolvedValue(2),
});

describe('NotificationInboxApiService', () => {
  it("always the actor's own items in the actor's tenant", async () => {
    const s = store();
    const svc = new NotificationInboxApiService(s);
    await svc.list(actor, { unreadOnly: true });
    expect(s.list).toHaveBeenCalledWith('u1', 't1', { unreadOnly: true, cursor: undefined });
    await expect(svc.unreadCount(actor)).resolves.toEqual({ unread: 3 });
    await expect(svc.markAllRead(actor)).resolves.toEqual({ marked: 2 });
  });

  it("another user's item is the same 404 as a missing one; a foreign cursor a 400; no inbox a 404", async () => {
    const s = store();
    await expect(new NotificationInboxApiService(s).markRead(actor, '9')).rejects.toBeInstanceOf(NotFoundException);
    vi.mocked(s.list).mockRejectedValueOnce(new InvalidDeliveryCursorError('x'));
    await expect(new NotificationInboxApiService(s).list(actor, { cursor: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(new NotificationInboxApiService(undefined).unreadCount(actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});
