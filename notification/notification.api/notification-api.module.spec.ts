import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import {
  NOTIFICATION_CONFIG_ADMIN_PORT,
  NOTIFICATION_OBSERVABILITY_PORT,
} from '../notification.core.database';
import { NOTIFIER } from '../notification.core';
import { NotificationApiModule } from './notification-api.module';
import { NotificationObservabilityController } from './observability/notification-observability.controller';
import { NotificationConfigAdminController } from './config-admin/notification-config-admin.controller';
import { NotificationTestSendController } from './test-send/notification-test-send.controller';
import { NOTIFICATION_AUDIT_EMITTER } from './tokens';
import { AuthorizationEnforcedGuard, type Actor } from '../../authorization/authorization.core';

const getDeliveryHistory = vi.fn().mockResolvedValue({ deliveries: [] });
const setChannelRoute = vi.fn().mockResolvedValue(undefined);
const notify = vi.fn().mockResolvedValue({ status: 'sent', channels: {} });
const auditRecord = vi.fn();

@Module({
  providers: [
    {
      provide: NOTIFICATION_OBSERVABILITY_PORT,
      useValue: {
        getDeliveryHistory,
        getDelivery: vi.fn().mockResolvedValue(null),
        getDeliveryContent: vi.fn().mockResolvedValue(null),
        configCoverageGaps: vi.fn().mockResolvedValue([]),
        getDeliveryStats: vi.fn().mockResolvedValue({ since: new Date(), until: new Date(), byChannel: [], byType: [], byDay: [] }),
      },
    },
    {
      provide: NOTIFICATION_CONFIG_ADMIN_PORT,
      useValue: {
        getChannelRoute: vi.fn().mockResolvedValue(null),
        getTemplate: vi.fn().mockResolvedValue(null),
        hasProviderCredential: vi.fn().mockResolvedValue(false),
        setChannelRoute,
        deleteChannelRoute: vi.fn(),
        listChannelRoutes: vi.fn().mockResolvedValue([]),
        setTemplate: vi.fn(),
        deleteTemplate: vi.fn(),
        listTemplates: vi.fn().mockResolvedValue([]),
        setProviderCredential: vi.fn(),
        deleteProviderCredential: vi.fn(),
        listProviderCredentials: vi.fn().mockResolvedValue([]),
      },
    },
    { provide: NOTIFIER, useValue: { notify } },
    { provide: 'MY_AUDIT', useValue: { record: auditRecord } },
  ],
  exports: [NOTIFICATION_OBSERVABILITY_PORT, NOTIFICATION_CONFIG_ADMIN_PORT, NOTIFIER, 'MY_AUDIT'],
})
class FakePortsModule {}

describe('NotificationApiModule.forRoot — real DI wiring', () => {
  it('every controller declares AuthorizationEnforcedGuard — fails closed without the global guard', () => {
    for (const controller of [NotificationObservabilityController, NotificationConfigAdminController, NotificationTestSendController]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(AuthorizationEnforcedGuard);
    }
  });

  async function build() {
    return Test.createTestingModule({
      imports: [NotificationApiModule.forRoot({ auditEmitterToken: 'MY_AUDIT', imports: [FakePortsModule] })],
    }).compile();
  }

  const platformActor: Actor = { id: 'a1', persona: 'platform', tenantId: null };

  it('resolves all three controllers', async () => {
    const moduleRef = await build();
    expect(moduleRef.get(NotificationObservabilityController)).toBeInstanceOf(NotificationObservabilityController);
    expect(moduleRef.get(NotificationConfigAdminController)).toBeInstanceOf(NotificationConfigAdminController);
    expect(moduleRef.get(NotificationTestSendController)).toBeInstanceOf(NotificationTestSendController);
  });

  it('observability controller routes through to the port', async () => {
    const moduleRef = await build();
    await moduleRef.get(NotificationObservabilityController).deliveries(platformActor, 'invoice.sent');
    expect(getDeliveryHistory).toHaveBeenCalled();
  });

  it('the delivery log answers api-contract Rule 4: { data, meta: { nextCursor } }', async () => {
    const moduleRef = await build();
    getDeliveryHistory.mockResolvedValueOnce({ deliveries: [{ id: '1' }], nextCursor: 'abc' });
    await expect(moduleRef.get(NotificationObservabilityController).deliveries(platformActor)).resolves.toEqual({
      data: [{ id: '1' }],
      meta: { nextCursor: 'abc' },
    });
  });

  it('config-admin controller is actor-scoped and audits via the bound emitter', async () => {
    const moduleRef = await build();
    await moduleRef.get(NotificationConfigAdminController).setRoute(platformActor, {
      notificationType: 'invoice.sent',
      tenantId: null,
      channels: ['email'],
    });
    expect(setChannelRoute).toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification.route_set' }));
  });

  it('test-send controller fires Notifier with the actor tenant', async () => {
    const moduleRef = await build();
    await moduleRef.get(NotificationTestSendController).testSend(
      { id: 'a1', persona: 'issuer', tenantId: 't1' },
      { recipient: { type: 'raw', email: 'p@e.com' }, notificationType: 'invoice.sent' },
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
  });

  it('falls back to the no-op audit emitter when auditEmitterToken is omitted', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationApiModule.forRoot({ imports: [FakePortsModule] })],
    }).compile();
    expect(moduleRef.get(NOTIFICATION_AUDIT_EMITTER)).toBeDefined();
  });
});
