import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { NotificationObservabilityApiService } from './notification-observability-api.service';
import type { NotificationObservabilityPort } from '../../notification.core.database';

function fakePort(): NotificationObservabilityPort {
  return {
    getDeliveryHistory: vi.fn().mockResolvedValue({ deliveries: [] }),
    getDeliveryContent: vi.fn().mockResolvedValue(null),
    configCoverageGaps: vi.fn().mockResolvedValue([]),
  };
}

describe('NotificationObservabilityApiService', () => {
  it('parses since/until into Dates and passes filters through', async () => {
    const port = fakePort();
    await new NotificationObservabilityApiService(port).getDeliveryHistory({
      notificationType: 'invoice.sent',
      since: '2026-01-01T00:00:00Z',
      limit: 10,
    });
    expect(port.getDeliveryHistory).toHaveBeenCalledWith(
      expect.objectContaining({ notificationType: 'invoice.sent', since: new Date('2026-01-01T00:00:00Z'), limit: 10 }),
    );
  });

  it('404s when there is no stored content for a delivery', async () => {
    const port = fakePort();
    await expect(new NotificationObservabilityApiService(port).getDeliveryContent('7')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the content record when present', async () => {
    const port = fakePort();
    const record = { id: '7', notificationType: 'x', channel: 'email' as const, recipientRef: 'r', attemptedAt: new Date(), content: { subject: null, body: 'b', isHtml: false, variables: {} } };
    (port.getDeliveryContent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(record);
    await expect(new NotificationObservabilityApiService(port).getDeliveryContent('7')).resolves.toBe(record);
  });

  it('passes coverage-gaps through', async () => {
    const port = fakePort();
    await new NotificationObservabilityApiService(port).coverageGaps();
    expect(port.configCoverageGaps).toHaveBeenCalled();
  });
});
