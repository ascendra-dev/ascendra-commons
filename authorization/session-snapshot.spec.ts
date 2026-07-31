import { describe, expect, it, vi } from 'vitest';
import { computeSessionSnapshot } from './session-snapshot';
import { Authorizer } from './authorizer';

describe('computeSessionSnapshot', () => {
  it('filters the full action list down to only what the actor is allowed', async () => {
    const actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
    const authorizer: Authorizer = {
      can: vi.fn(async (_actor, action: string) => action !== 'payment.refund'),
    };

    const snapshot = await computeSessionSnapshot(
      actor,
      ['invoice.create', 'invoice.void', 'payment.refund'],
      authorizer,
    );

    expect(snapshot).toEqual({ actor, allowedActions: ['invoice.create', 'invoice.void'] });
  });

  it('returns an empty allowedActions list when nothing is permitted', async () => {
    const actor = { id: 'u1', persona: 'payer', tenantId: null };
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(false) };

    const snapshot = await computeSessionSnapshot(actor, ['invoice.create'], authorizer);

    expect(snapshot.allowedActions).toEqual([]);
  });
});
