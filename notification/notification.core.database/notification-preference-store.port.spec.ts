import { describe, expect, it } from 'vitest';
import { preferenceAllows } from './notification-preference-store.port';

const rule = (notificationType: string, channel: string, enabled: boolean) => ({ notificationType, channel: channel as never, enabled });

describe('preferenceAllows — the most specific matching rule wins', () => {
  it('no rule: sent', () => {
    expect(preferenceAllows([], 'invoice.sent', 'email')).toBe(true);
  });

  it('(type, channel) › (type, *) › (*, channel) › (*, *)', () => {
    const rules = [rule('*', '*', false), rule('*', 'email', true), rule('invoice.reminder', '*', false), rule('invoice.reminder', 'sms', true)];
    expect(preferenceAllows(rules, 'invoice.reminder', 'sms')).toBe(true); // its own (type, channel)
    expect(preferenceAllows(rules, 'invoice.reminder', 'email')).toBe(false); // (type, *) beats (*, email)
    expect(preferenceAllows(rules, 'invoice.sent', 'email')).toBe(true); // (*, email)
    expect(preferenceAllows(rules, 'invoice.sent', 'sms')).toBe(false); // (*, *)
  });
});
