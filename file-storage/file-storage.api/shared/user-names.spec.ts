import { describe, expect, it, vi } from 'vitest';
import { userNames } from './user-names';

describe('userNames', () => {
  it('looks up each id once, skipping blanks and system actors', async () => {
    const directory = { findByIds: vi.fn().mockResolvedValue([{ id: 'u1', name: 'Hana Ito' }, { id: 'u2', name: null }]) };
    const names = await userNames(directory, ['u1', 'u1', null, 'u2', 'system:file-retention', undefined]);
    expect(directory.findByIds).toHaveBeenCalledWith(['u1', 'u2']);
    expect([...names]).toEqual([['u1', 'Hana Ito']]);
  });

  it('no directory, or a failing one, leaves the ids', async () => {
    expect(await userNames(null, ['u1'])).toEqual(new Map());
    expect(await userNames({ findByIds: vi.fn().mockRejectedValue(new Error('down')) }, ['u1'])).toEqual(new Map());
  });
});
