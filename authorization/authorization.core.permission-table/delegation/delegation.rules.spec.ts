import { describe, expect, it } from 'vitest';
import { assertDelegationExpiry, deriveDelegationStatus, undelegatableActions } from './delegation.rules';
import { InvalidDelegationExpiryError } from './delegation.errors';

function inDays(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

describe('deriveDelegationStatus', () => {
  it('revoked wins over everything', () => {
    expect(deriveDelegationStatus(inDays(5), new Date())).toBe('revoked');
  });
  it('expired when past and not revoked', () => {
    expect(deriveDelegationStatus(inDays(-1), null)).toBe('expired');
  });
  it('active when future and not revoked', () => {
    expect(deriveDelegationStatus(inDays(1), null)).toBe('active');
  });
});

describe('assertDelegationExpiry', () => {
  it('accepts a valid future date within the cap', () => {
    expect(() => assertDelegationExpiry(inDays(30), 90)).not.toThrow();
  });
  it('rejects an invalid date', () => {
    expect(() => assertDelegationExpiry(new Date('nope'), 90)).toThrow(InvalidDelegationExpiryError);
  });
  it('rejects a past date', () => {
    expect(() => assertDelegationExpiry(inDays(-1), 90)).toThrow(InvalidDelegationExpiryError);
  });
  it('rejects a date beyond the cap', () => {
    expect(() => assertDelegationExpiry(inDays(120), 90)).toThrow(/90-day maximum/);
  });
});

describe('undelegatableActions', () => {
  it('returns [] when the granter has grantsAll', () => {
    expect(undelegatableActions(['a', 'b'], { grantsAll: true, actions: new Set() })).toEqual([]);
  });
  it('returns the requested actions the granter lacks from roles', () => {
    expect(undelegatableActions(['a', 'b', 'c'], { grantsAll: false, actions: new Set(['a']) })).toEqual(['b', 'c']);
  });
  it('returns [] when the granter holds every requested action', () => {
    expect(undelegatableActions(['a'], { grantsAll: false, actions: new Set(['a', 'b']) })).toEqual([]);
  });
});
