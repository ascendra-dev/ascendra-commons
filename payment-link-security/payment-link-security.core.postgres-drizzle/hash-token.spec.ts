import { describe, expect, it } from 'vitest';
import { hashToken } from './hash-token';

describe('hashToken', () => {
  it('is deterministic — the same input always hashes the same way', () => {
    expect(hashToken('abc123')).toBe(hashToken('abc123'));
  });

  it('produces a 64-char lowercase hex SHA-256 digest', () => {
    expect(hashToken('abc123')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different inputs hash differently', () => {
    expect(hashToken('abc123')).not.toBe(hashToken('abc124'));
  });

  it('never returns the raw input', () => {
    expect(hashToken('abc123')).not.toContain('abc123');
  });
});
