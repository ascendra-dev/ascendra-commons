import { describe, expect, it, vi } from 'vitest';
import { recipientNames } from './recipient-names';

describe('recipientNames', () => {
  it('names user recipients in one findByIds call — never a guest', async () => {
    const resolver = { findById: vi.fn(), findByIds: vi.fn().mockResolvedValue([{ id: 'u1', name: 'Hana Ito' }]) };
    const names = await recipientNames(resolver, ['user:u1', 'user:u1', 'raw:email', 'h:abc', null, 'user:u2']);
    expect(resolver.findByIds).toHaveBeenCalledWith(['u1', 'u2']);
    expect(resolver.findById).not.toHaveBeenCalled();
    expect([...names]).toEqual([['user:u1', 'Hana Ito']]);
  });

  it('without findByIds, one findById each; a failing directory leaves the ids — never fails the read', async () => {
    const resolver = { findById: vi.fn(async (id: string) => (id === 'u1' ? { name: 'Li Wei' } : null)) };
    expect([...(await recipientNames(resolver, ['user:u1', 'user:u2']))]).toEqual([['user:u1', 'Li Wei']]);
    const broken = { findById: vi.fn().mockRejectedValue(new Error('down')) };
    await expect(recipientNames(broken, ['user:u1'])).resolves.toEqual(new Map());
    await expect(recipientNames(null, ['user:u1'])).resolves.toEqual(new Map());
  });
});
