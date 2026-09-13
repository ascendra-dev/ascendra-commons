import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { NotificationObservabilityApiService } from './notification-observability-api.service';
import type { NotificationObservabilityPort } from '../../notification.core.database';
import type { NotificationApiOptions } from '../notification-api.options';
import type { Actor } from '../../../authorization/authorization.core';

function fakePort(): NotificationObservabilityPort {
  return {
    getDeliveryHistory: vi.fn().mockResolvedValue({ deliveries: [] }),
    getDelivery: vi.fn().mockResolvedValue(null),
    getDeliveryContent: vi.fn().mockResolvedValue(null),
    configCoverageGaps: vi.fn().mockResolvedValue([]),
    getDeliveryStats: vi.fn().mockResolvedValue({ since: new Date(), until: new Date(), byChannel: [], byType: [], byDay: [] }),
  };
}

function options(isPlatformAdmin: NotificationApiOptions['isPlatformAdmin'] = (a) => a.tenantId === null): NotificationApiOptions {
  return { isPlatformAdmin };
}

const tenantActor: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
const platformActor: Actor = { id: 'p1', persona: 'platform', tenantId: null };

describe('NotificationObservabilityApiService', () => {
  describe('getDeliveryHistory — tenant ceiling', () => {
    it('parses since/until into Dates and passes filters through for a platform admin', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options()).getDeliveryHistory(platformActor, {
        notificationType: 'invoice.sent',
        since: '2026-01-01T00:00:00Z',
        limit: 10,
      });
      expect(port.getDeliveryHistory).toHaveBeenCalledWith(
        expect.objectContaining({ notificationType: 'invoice.sent', since: new Date('2026-01-01T00:00:00Z'), limit: 10 }),
      );
    });

    it('lets a platform admin request another tenant explicitly', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options()).getDeliveryHistory(platformActor, { tenantId: 't9' });
      expect(port.getDeliveryHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9' }));
    });

    it('forces a non-platform actor to their own tenant, ignoring a requested tenantId for another tenant', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options()).getDeliveryHistory(tenantActor, { tenantId: 't2' });
      expect(port.getDeliveryHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    });

    it('scopes a non-platform actor to their own tenant even when no tenantId was requested', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options()).getDeliveryHistory(tenantActor, {});
      expect(port.getDeliveryHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    });
  });

  describe('getDelivery', () => {
    it('404s when the row does not exist', async () => {
      const port = fakePort();
      await expect(
        new NotificationObservabilityApiService(port, options()).getDelivery(tenantActor, '7'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s (not 403) when a non-platform actor asks for another tenant\'s row — no existence leak', async () => {
      const port = fakePort();
      const record = { id: '7', notificationType: 'x', channel: 'email' as const, tenantId: 't2', recipientRef: 'r', status: 'sent' as const, reason: null, providerMessageId: null, attemptedAt: new Date(), updatedAt: new Date(), correlationId: null, hasContent: false };
      (port.getDelivery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);
      await expect(
        new NotificationObservabilityApiService(port, options()).getDelivery(tenantActor, '7'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the row for a non-platform actor fetching their own tenant', async () => {
      const port = fakePort();
      const record = { id: '7', notificationType: 'x', channel: 'email' as const, tenantId: 't1', recipientRef: 'r', status: 'sent' as const, reason: null, providerMessageId: null, attemptedAt: new Date(), updatedAt: new Date(), correlationId: null, hasContent: false };
      (port.getDelivery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);
      await expect(new NotificationObservabilityApiService(port, options()).getDelivery(tenantActor, '7')).resolves.toBe(record);
    });

    it('returns a row from any tenant for a platform admin', async () => {
      const port = fakePort();
      const record = { id: '7', notificationType: 'x', channel: 'email' as const, tenantId: 't2', recipientRef: 'r', status: 'sent' as const, reason: null, providerMessageId: null, attemptedAt: new Date(), updatedAt: new Date(), correlationId: null, hasContent: false };
      (port.getDelivery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);
      await expect(new NotificationObservabilityApiService(port, options()).getDelivery(platformActor, '7')).resolves.toBe(record);
    });
  });

  describe('getDeliveryContent', () => {
    it('404s when there is no stored content for a delivery', async () => {
      const port = fakePort();
      await expect(new NotificationObservabilityApiService(port, options()).getDeliveryContent('7')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the content record when present', async () => {
      const port = fakePort();
      const record = { id: '7', notificationType: 'x', channel: 'email' as const, recipientRef: 'r', attemptedAt: new Date(), content: { subject: null, body: 'b', isHtml: false, variables: {} } };
      (port.getDeliveryContent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);
      await expect(new NotificationObservabilityApiService(port, options()).getDeliveryContent('7')).resolves.toBe(record);
    });
  });

  it('passes coverage-gaps through', async () => {
    const port = fakePort();
    await new NotificationObservabilityApiService(port, options()).coverageGaps();
    expect(port.configCoverageGaps).toHaveBeenCalled();
  });

  describe('getDeliveryStats', () => {
    it('defaults to a 7-day window ending now', async () => {
      const port = fakePort();
      const before = Date.now();
      await new NotificationObservabilityApiService(port, options()).getDeliveryStats(platformActor, {});
      const call = (port.getDeliveryStats as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.until.getTime()).toBeGreaterThanOrEqual(before);
      expect(call.until.getTime() - call.since.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('parses an hour window', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options()).getDeliveryStats(platformActor, { window: '24h' });
      const call = (port.getDeliveryStats as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.until.getTime() - call.since.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('forces a non-platform actor to their own tenant', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options()).getDeliveryStats(tenantActor, { tenantId: 't2' });
      expect(port.getDeliveryStats).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    });

    it('lets a platform admin request any tenant', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options()).getDeliveryStats(platformActor, { tenantId: 't9' });
      expect(port.getDeliveryStats).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9' }));
    });
  });
});
