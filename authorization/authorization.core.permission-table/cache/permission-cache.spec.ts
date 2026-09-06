import { describe, expect, it, vi } from 'vitest';
import { memoizePermissionLookup, runWithPermissionCache } from './permission-cache';

describe('permission-cache', () => {
  it('memoizes by key within a scope', async () => {
    const load = vi.fn(async () => 'value');

    await runWithPermissionCache(async () => {
      const a = await memoizePermissionLookup('k', load);
      const b = await memoizePermissionLookup('k', load);
      expect(a).toBe('value');
      expect(b).toBe('value');
    });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keys are independent', async () => {
    const load = vi.fn(async (v: string) => v);

    await runWithPermissionCache(async () => {
      await memoizePermissionLookup('a', () => load('a'));
      await memoizePermissionLookup('b', () => load('b'));
    });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent lookups for the same key (caches the in-flight promise)', async () => {
    const load = vi.fn(() => new Promise((r) => setTimeout(() => r('v'), 5)));

    await runWithPermissionCache(async () => {
      await Promise.all([memoizePermissionLookup('k', load), memoizePermissionLookup('k', load)]);
    });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('without a scope, every call runs the loader (degrades to no-cache)', async () => {
    const load = vi.fn(async () => 'v');

    await memoizePermissionLookup('k', load);
    await memoizePermissionLookup('k', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('separate scopes do not share', async () => {
    const load = vi.fn(async () => 'v');

    await runWithPermissionCache(() => memoizePermissionLookup('k', load));
    await runWithPermissionCache(() => memoizePermissionLookup('k', load));

    expect(load).toHaveBeenCalledTimes(2);
  });
});
