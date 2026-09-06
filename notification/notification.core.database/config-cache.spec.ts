import { describe, expect, it, vi } from 'vitest';
import { ConfigCache } from './config-cache';

describe('ConfigCache', () => {
  it('serves a cached value within the TTL, reloads after it', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 'v1');
    const cache = new ConfigCache(1000);

    await cache.get('k', load);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);
    load.mockResolvedValue('v2');
    await expect(cache.get('k', load)).resolves.toBe('v2');
    expect(load).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('keys are independent', async () => {
    const load = vi.fn(async (v: string) => v);
    const cache = new ConfigCache(1000);

    await cache.get('a', () => load('a'));
    await cache.get('b', () => load('b'));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ttl <= 0 disables the cache entirely', async () => {
    const load = vi.fn(async () => 'v');
    const cache = new ConfigCache(0);

    await cache.get('k', load);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('stays bounded — evicts to make room past maxEntries', async () => {
    const cache = new ConfigCache(60_000, 3);
    for (let i = 0; i < 10; i++) await cache.get(`k${i}`, async () => i);

    // internal Map is private; prove it by forcing a reload of an early key
    const load = vi.fn(async () => 'reloaded');
    await expect(cache.get('k0', load)).resolves.toBe('reloaded');
    expect(load).toHaveBeenCalled();
  });
});
