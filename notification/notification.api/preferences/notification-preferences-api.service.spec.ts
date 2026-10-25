import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationPreferencesApiService } from './notification-preferences-api.service';
import { NotificationTypeCatalog } from '../types/notification-type-catalog';
import type { NotificationConfigAdminPort, NotificationPreferenceStore } from '../../notification.core.database';
import type { Actor } from '../../../authorization/authorization.core';

const actor: Actor = { id: 'u1', persona: 'member', tenantId: 't1' };
const types = new NotificationTypeCatalog([
  { name: 'invoice.reminder', description: 'A payment reminder' },
  { name: 'password.reset', required: true },
]);

function deps(store?: NotificationPreferenceStore) {
  const config = {
    getChannelRoute: vi.fn(async (type: string, tenantId: string | null) =>
      type === 'invoice.reminder' && tenantId === 't1' ? { notificationType: type, tenantId, channels: ['email', 'sms'] } : tenantId === null ? { notificationType: type, tenantId, channels: ['email'] } : null,
    ),
  } as unknown as NotificationConfigAdminPort;
  return { config, svc: new NotificationPreferencesApiService(config, types, store) };
}
const store = (rules: unknown[] = []): NotificationPreferenceStore => ({ listRules: vi.fn().mockResolvedValue(rules), setRule: vi.fn() });

describe('NotificationPreferencesApiService', () => {
  it("my types, the channels each reaches me on (my tenant's route, else the default), on or off", async () => {
    const { svc } = deps(store([{ notificationType: 'invoice.reminder', channel: 'sms', enabled: false, updatedAt: new Date() }]));
    const mine = await svc.mine(actor);
    expect(mine.types).toEqual([
      { name: 'invoice.reminder', description: 'A payment reminder', audience: null, required: false, channels: [{ channel: 'email', enabled: true }, { channel: 'sms', enabled: false }] },
      { name: 'password.reset', description: null, audience: null, required: true, channels: [{ channel: 'email', enabled: true }] },
    ]);
  });

  it("sets my own rule — a wildcard is fine; a required type, an unknown type or channel, or no enabled is a 400", async () => {
    const s = store();
    const { svc } = deps(s);
    await svc.set(actor, { notificationType: '*', channel: 'sms', enabled: false });
    expect(s.setRule).toHaveBeenCalledWith('u1', { notificationType: '*', channel: 'sms', enabled: false });
    for (const body of [
      { notificationType: 'password.reset', channel: 'email', enabled: false },
      { notificationType: 'nope', channel: 'email', enabled: false },
      { notificationType: 'invoice.reminder', channel: 'fax', enabled: false },
      { notificationType: 'invoice.reminder', channel: 'sms' },
    ]) {
      await expect(svc.set(actor, body)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('an app without preferences answers 404', async () => {
    await expect(deps(undefined).svc.mine(actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});
