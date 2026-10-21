import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RateLimitingApiService } from './rate-limiting-api.service';
import { InvalidRateLimitCursorError, type RateLimitObservabilityPort } from '../rate-limiting.core';

function service() {
  const observability: RateLimitObservabilityPort = {
    listRejections: vi.fn().mockResolvedValue({ rejections: [] }),
    rejectionCatalog: vi.fn().mockResolvedValue([]),
    topIdentifiers: vi.fn().mockResolvedValue([]),
    volume: vi.fn().mockResolvedValue({ oldestWindowAt: null, rowCount: 0, tableSizeBytes: null, perDay: [] }),
  };
  return { svc: new RateLimitingApiService(observability), observability };
}

describe('RateLimitingApiService', () => {
  it('listRejections parses since/until into Dates and passes filters through unchanged', async () => {
    const { svc, observability } = service();
    await svc.listRejections({
      route: '/pay/:token',
      identifier: '1.2.3.4',
      correlationId: 'corr-1',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z',
      limit: 10,
      cursor: 'cur-1',
    });

    expect(observability.listRejections).toHaveBeenCalledWith({
      route: '/pay/:token',
      identifier: '1.2.3.4',
      correlationId: 'corr-1',
      since: new Date('2026-01-01T00:00:00.000Z'),
      until: new Date('2026-02-01T00:00:00.000Z'),
      limit: 10,
      cursor: 'cur-1',
    });
  });

  it('getTrace overrides correlationId onto the base query', async () => {
    const { svc, observability } = service();
    await svc.getTrace('corr-9', { limit: 5 });
    expect(observability.listRejections).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'corr-9', limit: 5 }));
  });

  it('rejectionCatalog parses since into a Date', async () => {
    const { svc, observability } = service();
    await svc.rejectionCatalog('2026-01-01T00:00:00.000Z');
    expect(observability.rejectionCatalog).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('topIdentifiers parses since into a Date and passes route/limit through', async () => {
    const { svc, observability } = service();
    await svc.topIdentifiers({ since: '2026-01-01T00:00:00.000Z', route: '/pay/:token', limit: 5 });
    expect(observability.topIdentifiers).toHaveBeenCalledWith({
      since: new Date('2026-01-01T00:00:00.000Z'),
      route: '/pay/:token',
      limit: 5,
    });
  });

  it('volume passes the time zone through, UTC by default at the adapter', async () => {
    const { svc, observability } = service();
    await svc.volume('Asia/Karachi');
    await svc.volume();
    expect(observability.volume).toHaveBeenNthCalledWith(1, 'Asia/Karachi');
    expect(observability.volume).toHaveBeenNthCalledWith(2, undefined);
  });

  describe('a bad param is a 400, never a 500', () => {
    it.each([
      ['since', { since: 'garbage' }],
      ['until', { until: '2026-13-45' }],
      ['limit', { limit: Number('abc') }],
      ['limit', { limit: 1.5 }],
      ['limit', { limit: 0 }],
    ])('listRejections — bad %s', async (_name, dto) => {
      const { svc, observability } = service();
      await expect(svc.listRejections(dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(observability.listRejections).not.toHaveBeenCalled();
    });

    it('a cursor the adapter rejects', async () => {
      const { svc, observability } = service();
      vi.mocked(observability.listRejections).mockRejectedValueOnce(new InvalidRateLimitCursorError('bad'));
      await expect(svc.listRejections({ cursor: 'garbage' })).rejects.toThrow(/"cursor" is not one this endpoint returned/);
    });

    it('catalog and top-identifiers dates and limits', async () => {
      const { svc } = service();
      expect(() => svc.rejectionCatalog('nope')).toThrow(BadRequestException);
      expect(() => svc.topIdentifiers({ since: 'nope' })).toThrow(BadRequestException);
      expect(() => svc.topIdentifiers({ limit: -5 })).toThrow(BadRequestException);
      expect(() => svc.volume('Mars/Olympus')).toThrow(/Unknown time zone/);
    });
  });
});
