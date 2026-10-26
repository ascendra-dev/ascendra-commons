import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationObservabilityApiService } from './notification-observability-api.service';
import { InvalidDeliveryCursorError, type NotificationObservabilityPort } from '../../notification.core.database';
import { NotificationRecipientHasher } from '../../notification.core';
import type { NotificationApiOptions } from '../notification-api.options';
import type { Actor } from '../../../authorization/authorization.core';

function fakePort(): NotificationObservabilityPort {
  return {
    getDeliveryHistory: vi.fn().mockResolvedValue({ deliveries: [] }),
    getDelivery: vi.fn().mockResolvedValue(null),
    getDeliveryContent: vi.fn().mockResolvedValue(null),
    configCoverageGaps: vi.fn().mockResolvedValue([]),
    getDeliveryStats: vi.fn().mockResolvedValue({ since: new Date(), until: new Date(), byChannel: [], byType: [], byDay: [] }),
    volume: vi.fn().mockResolvedValue({ oldestAttemptedAt: null, rowCount: 0, contentRowCount: 0, oldestContentAt: null, tableSizeBytes: null, perDay: [] }),
  };
}

function options(isPlatformAdmin: NotificationApiOptions['isPlatformAdmin'] = (a) => a.tenantId === null): NotificationApiOptions {
  return { isPlatformAdmin };
}

const audit = { record: vi.fn() };

const tenantActor: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
const platformActor: Actor = { id: 'p1', persona: 'platform', tenantId: null };

describe('NotificationObservabilityApiService', () => {
  it("names a page's user recipients through the app's resolver; a guest has none", async () => {
    const port = fakePort();
    vi.mocked(port.getDeliveryHistory).mockResolvedValueOnce({
      deliveries: [{ id: '1', recipientRef: 'user:u1' }, { id: '2', recipientRef: 'raw:email' }] as never,
    });
    const users = { findById: vi.fn(), findByIds: vi.fn().mockResolvedValue([{ id: 'u1', name: 'Hana Ito' }]) };
    const page = await new NotificationObservabilityApiService(port, options(), audit, undefined, null, users).getDeliveryHistory(platformActor, {});
    expect(page.deliveries.map((d) => d.recipientName)).toEqual(['Hana Ito', null]);
  });

  describe('searching by recipient', () => {
    const hasher = new NotificationRecipientHasher('a-test-secret-of-32-characters!!');

    it('an address is hashed the way Notifier keys it — it never reaches the port', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit, undefined, hasher).getDeliveryHistory(platformActor, {
        recipientAddress: 'Ada@Example.com',
      });
      const query = vi.mocked(port.getDeliveryHistory).mock.calls[0][0]!;
      expect(query.recipientKey).toBe(hasher.hashEmail('ada@example.com'));
      expect(JSON.stringify(query)).not.toContain('Example');
    });

    it('a phone number too; a key passes as given', async () => {
      const port = fakePort();
      const svc = new NotificationObservabilityApiService(port, options(), audit, undefined, hasher);
      await svc.getDeliveryHistory(platformActor, { recipientAddress: '+1 555 0100' });
      expect(vi.mocked(port.getDeliveryHistory).mock.calls[0][0]!.recipientKey).toBe(hasher.hashPhone('15550100'));
      await svc.getDeliveryHistory(platformActor, { recipientKey: 'user:u1' });
      expect(vi.mocked(port.getDeliveryHistory).mock.calls[1][0]!.recipientKey).toBe('user:u1');
    });

    it('without hashing, or with both given, a 400', async () => {
      await expect(
        new NotificationObservabilityApiService(fakePort(), options(), audit).getDeliveryHistory(platformActor, { recipientAddress: 'a@b.c' }),
      ).rejects.toThrow(/recipientHashKey/);
      await expect(
        new NotificationObservabilityApiService(fakePort(), options(), audit, undefined, hasher).getDeliveryHistory(platformActor, {
          recipientAddress: 'a@b.c',
          recipientKey: 'user:u1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("a caller's mistake is a 400, never a 500", () => {
    const svc = () => new NotificationObservabilityApiService(fakePort(), options(), audit);
    it.each([
      ['a bad date', { since: 'yesterday' }],
      ['a bad limit', { limit: Number('abc') }],
      ['a zero limit', { limit: 0 }],
      ['an unknown channel', { channel: 'fax' }],
      ['an unknown status', { status: 'lost' }],
      ['a NUL byte', { notificationType: 'invoice\u0000sent' }],
      ['a malformed correlation id', { correlationId: 'has spaces' }],
      ['a reason that is not a code', { reason: "x' or 1=1" }],
    ])('%s', async (_label, query) => {
      await expect(svc().getDeliveryHistory(platformActor, query)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a cursor the reader never issued', async () => {
      const port = fakePort();
      vi.mocked(port.getDeliveryHistory).mockRejectedValueOnce(new InvalidDeliveryCursorError('Unrecognized cursor "x"'));
      await expect(
        new NotificationObservabilityApiService(port, options(), audit).getDeliveryHistory(platformActor, { cursor: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['7', 'week', '0d', '400d'])('stats window %s', async (window) => {
      await expect(svc().getDeliveryStats(platformActor, { window })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stats window 24h and 30d are fine', async () => {
      await expect(svc().getDeliveryStats(platformActor, { window: '24h' })).resolves.toBeDefined();
      await expect(svc().getDeliveryStats(platformActor, { window: '30d' })).resolves.toBeDefined();
    });
  });

  describe('getDeliveryHistory — tenant ceiling', () => {
    it('parses since/until into Dates and passes filters through for a platform admin', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryHistory(platformActor, {
        notificationType: 'invoice.sent',
        since: '2026-01-01T00:00:00Z',
        limit: 10,
      });
      expect(port.getDeliveryHistory).toHaveBeenCalledWith(
        expect.objectContaining({ notificationType: 'invoice.sent', since: new Date('2026-01-01T00:00:00Z'), limit: 10 }),
      );
    });

    it('status=failed,bounced is any of them; an unknown one in the list is a 400', async () => {
      const port = fakePort();
      const svc = new NotificationObservabilityApiService(port, options(), audit);
      await svc.getDeliveryHistory(platformActor, { status: 'failed,bounced' });
      expect(port.getDeliveryHistory).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['failed', 'bounced'] }));
      await expect(svc.getDeliveryHistory(platformActor, { status: 'failed,lost' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets a platform admin request another tenant explicitly', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryHistory(platformActor, { tenantId: 't9' });
      expect(port.getDeliveryHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9' }));
    });

    it('forces a non-platform actor to their own tenant, ignoring a requested tenantId for another tenant', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryHistory(tenantActor, { tenantId: 't2' });
      expect(port.getDeliveryHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    });

    it('scopes a non-platform actor to their own tenant even when no tenantId was requested', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryHistory(tenantActor, {});
      expect(port.getDeliveryHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    });
  });

  describe('getDelivery', () => {
    it('404s when the row does not exist', async () => {
      const port = fakePort();
      await expect(
        new NotificationObservabilityApiService(port, options(), audit).getDelivery(tenantActor, '7'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s (not 403) when a non-platform actor asks for another tenant\'s row — no existence leak', async () => {
      const port = fakePort();
      const record = { id: '7', notificationType: 'x', channel: 'email' as const, tenantId: 't2', recipientRef: 'r', status: 'sent' as const, reason: null, providerMessageId: null, attemptedAt: new Date(), updatedAt: new Date(), correlationId: null, hasContent: false };
      (port.getDelivery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);
      await expect(
        new NotificationObservabilityApiService(port, options(), audit).getDelivery(tenantActor, '7'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the row for a non-platform actor fetching their own tenant', async () => {
      const port = fakePort();
      const record = { id: '7', notificationType: 'x', channel: 'email' as const, tenantId: 't1', recipientRef: 'r', status: 'sent' as const, reason: null, providerMessageId: null, attemptedAt: new Date(), updatedAt: new Date(), correlationId: null, hasContent: false };
      (port.getDelivery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);
      await expect(new NotificationObservabilityApiService(port, options(), audit).getDelivery(tenantActor, '7')).resolves.toEqual({ ...record, recipientName: null });
    });

    it('returns a row from any tenant for a platform admin', async () => {
      const port = fakePort();
      const record = { id: '7', notificationType: 'x', channel: 'email' as const, tenantId: 't2', recipientRef: 'r', status: 'sent' as const, reason: null, providerMessageId: null, attemptedAt: new Date(), updatedAt: new Date(), correlationId: null, hasContent: false };
      (port.getDelivery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);
      await expect(new NotificationObservabilityApiService(port, options(), audit).getDelivery(platformActor, '7')).resolves.toEqual({ ...record, recipientName: null });
    });
  });

  describe('getDeliveryContent — scoped like the row', () => {
    const row = (tenantId: string | null) => ({ id: '7', tenantId, notificationType: 'x' });
    const content = { id: '7', notificationType: 'x', channel: 'email' as const, recipientRef: 'r', attemptedAt: new Date(), content: { subject: null, body: 'b', isHtml: false, variables: {} } };

    it("another tenant's delivery is the same 404 as a missing one — its content is never read", async () => {
      const port = fakePort();
      vi.mocked(port.getDelivery).mockResolvedValueOnce(row('t2') as never);
      await expect(new NotificationObservabilityApiService(port, options(), audit).getDeliveryContent(tenantActor, '7')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(port.getDeliveryContent).not.toHaveBeenCalled();
    });

    it('a missing delivery is a 404', async () => {
      const port = fakePort();
      await expect(new NotificationObservabilityApiService(port, options(), audit).getDeliveryContent(tenantActor, '7')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('own tenant, no stored content — a 404', async () => {
      const port = fakePort();
      vi.mocked(port.getDelivery).mockResolvedValueOnce(row('t1') as never);
      await expect(new NotificationObservabilityApiService(port, options(), audit).getDeliveryContent(tenantActor, '7')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("each read is audited under the delivery's tenant — a refused one is not", async () => {
      const port = fakePort();
      audit.record.mockClear();
      vi.mocked(port.getDelivery).mockResolvedValue(row('t1') as never);
      vi.mocked(port.getDeliveryContent).mockResolvedValue(content);
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryContent(platformActor, '7');
      expect(audit.record).toHaveBeenCalledWith({
        action: 'notification.content_viewed', actorId: 'p1', tenantId: 't1', entityType: 'delivery', entityId: '7',
      });
      vi.mocked(port.getDelivery).mockResolvedValue(row('t2') as never);
      await expect(new NotificationObservabilityApiService(port, options(), audit).getDeliveryContent(tenantActor, '7')).rejects.toThrow();
      expect(audit.record).toHaveBeenCalledTimes(1);
    });

    it('own tenant — the content; a platform admin reads any tenant', async () => {
      const port = fakePort();
      vi.mocked(port.getDelivery).mockResolvedValue(row('t1') as never);
      vi.mocked(port.getDeliveryContent).mockResolvedValue(content);
      await expect(new NotificationObservabilityApiService(port, options(), audit).getDeliveryContent(tenantActor, '7')).resolves.toBe(content);
      await expect(new NotificationObservabilityApiService(port, options(), audit).getDeliveryContent(platformActor, '7')).resolves.toBe(content);
    });
  });

  it("coverage gaps: a platform admin's checks every tenant the app's directory names", async () => {
    const port = fakePort();
    const directory = { listTenantIds: vi.fn().mockResolvedValue(['t1', 't2']) };
    await new NotificationObservabilityApiService(port, options(), audit, directory).coverageGaps(platformActor);
    expect(port.configCoverageGaps).toHaveBeenLastCalledWith(undefined, ['t1', 't2']);
    await new NotificationObservabilityApiService(port, options(), audit, directory).coverageGaps(tenantActor);
    expect(port.configCoverageGaps).toHaveBeenLastCalledWith({ tenantId: 't1' });
    expect(directory.listTenantIds).toHaveBeenCalledTimes(1);
  });

  it('coverage gaps: a tenant admin only their own tenant and the defaults; a platform admin all', async () => {
    const port = fakePort();
    await new NotificationObservabilityApiService(port, options(), audit).coverageGaps(tenantActor);
    expect(port.configCoverageGaps).toHaveBeenLastCalledWith({ tenantId: 't1' });
    await new NotificationObservabilityApiService(port, options(), audit).coverageGaps(platformActor);
    expect(port.configCoverageGaps).toHaveBeenLastCalledWith(undefined, undefined);
  });

  describe('getDeliveryStats', () => {
    it('defaults to 7 whole calendar days in UTC', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryStats(platformActor, {});
      expect(port.getDeliveryStats).toHaveBeenCalledWith({ tenantId: undefined, days: 7, timeZone: 'UTC' });
    });

    it("a day window counts in the viewer's zone", async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryStats(platformActor, { window: '30d', tz: 'Asia/Karachi' });
      expect(port.getDeliveryStats).toHaveBeenCalledWith(expect.objectContaining({ days: 30, timeZone: 'Asia/Karachi' }));
    });

    it('an unknown zone is a 400', async () => {
      await expect(
        new NotificationObservabilityApiService(fakePort(), options(), audit).getDeliveryStats(platformActor, { tz: 'Mars/Olympus' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('parses an hour window', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryStats(platformActor, { window: '24h' });
      const call = (port.getDeliveryStats as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.until.getTime() - call.since.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('forces a non-platform actor to their own tenant', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryStats(tenantActor, { tenantId: 't2' });
      expect(port.getDeliveryStats).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    });

    it('lets a platform admin request any tenant', async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).getDeliveryStats(platformActor, { tenantId: 't9' });
      expect(port.getDeliveryStats).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9' }));
    });
  });

  describe('volume', () => {
    it("is the platform's — a tenant admin gets a 403 (the table holds every tenant's rows)", async () => {
      const port = fakePort();
      await expect(new NotificationObservabilityApiService(port, options(), audit).volume(tenantActor)).rejects.toBeInstanceOf(ForbiddenException);
      expect(port.volume).not.toHaveBeenCalled();
    });

    it("a platform admin's, in their zone; a bad zone is a 400", async () => {
      const port = fakePort();
      await new NotificationObservabilityApiService(port, options(), audit).volume(platformActor, 'Asia/Dubai');
      expect(port.volume).toHaveBeenCalledWith('Asia/Dubai');
      await expect(new NotificationObservabilityApiService(port, options(), audit).volume(platformActor, 'nope')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
