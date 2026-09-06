import { describe, expect, it } from 'vitest';
import { humanizeDuration, parseCadence } from './cadence';

describe('parseCadence', () => {
  it('parses unit suffixes', () => {
    expect(parseCadence('90s').seconds).toBe(90);
    expect(parseCadence('30m').seconds).toBe(1800);
    expect(parseCadence('2h').seconds).toBe(7200);
    expect(parseCadence('1d').seconds).toBe(86400);
  });

  it('accepts a plain number as seconds', () => {
    expect(parseCadence(3600)).toEqual({ seconds: 3600, label: '1 hour' });
  });

  it('carries a human label', () => {
    expect(parseCadence('1d').label).toBe('1 day');
    expect(parseCadence('45m').label).toBe('45 minutes');
  });

  it('throws on anything it cannot parse — a wiring typo should fail loudly', () => {
    expect(() => parseCadence('daily')).toThrow(/Invalid cadence/);
    expect(() => parseCadence('1w')).toThrow(/Invalid cadence/);
    expect(() => parseCadence(0)).toThrow(/Invalid cadence/);
    expect(() => parseCadence(-5)).toThrow(/Invalid cadence/);
  });
});

describe('humanizeDuration', () => {
  it('picks the largest whole unit', () => {
    expect(humanizeDuration(50)).toBe('50 seconds');
    expect(humanizeDuration(3600)).toBe('1 hour');
    expect(humanizeDuration(90000)).toBe('1 day');
    expect(humanizeDuration(2 * 86400)).toBe('2 days');
  });

  it('never goes negative', () => {
    expect(humanizeDuration(-100)).toBe('0 seconds');
  });
});
