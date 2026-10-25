import { describe, expect, it } from 'vitest';
import { NotificationRecipientHasher, recipientKey } from './recipient-hasher';

const hasher = new NotificationRecipientHasher('a-test-secret-of-32-characters!!');

describe('NotificationRecipientHasher', () => {
  it('the same person hashes the same — an email by case and spaces, a phone by its digits', () => {
    expect(hasher.hashEmail(' Ada@Example.com ')).toBe(hasher.hashEmail('ada@example.com'));
    expect(hasher.hashPhone('+1 (555) 010-0')).toBe(hasher.hashPhone('15550100'));
    expect(hasher.hashEmail('ada@example.com')).not.toBe(hasher.hashEmail('bob@example.com'));
  });

  it('keyed — another secret gives another hash, and the address never appears', () => {
    const other = new NotificationRecipientHasher('another-secret-of-32-characters!');
    expect(other.hashEmail('ada@example.com')).not.toBe(hasher.hashEmail('ada@example.com'));
    expect(hasher.hashEmail('ada@example.com')).not.toContain('ada');
  });

  it('refuses a key too short to be a secret', () => {
    expect(() => new NotificationRecipientHasher('short')).toThrow(/at least 16/);
  });
});

describe('recipientKey', () => {
  it("a user is user:<id>; a raw recipient the hash of the channel's address — or nothing without a hasher", () => {
    expect(recipientKey('email', { type: 'user', id: 'u1' }, null)).toBe('user:u1');
    const raw = { type: 'raw' as const, email: 'ada@example.com', phone: '+15550100' };
    expect(recipientKey('email', raw, hasher)).toBe(hasher.hashEmail('ada@example.com'));
    expect(recipientKey('sms', raw, hasher)).toBe(hasher.hashPhone('+15550100'));
    expect(recipientKey('email', raw, null)).toBeNull();
    expect(recipientKey('sms', { type: 'raw', email: 'a@b.c' }, hasher)).toBeNull();
  });
});
