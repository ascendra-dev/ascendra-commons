import { describe, expect, it } from 'vitest';
import { fillDailyCounts, kpiValue, parseStatsWindow } from './stats-window';

const now = new Date('2026-09-13T00:00:00Z');

describe('parseStatsWindow', () => {
  it('parses a "<n>d" window relative to now', () => {
    expect(parseStatsWindow('7d', now)).toEqual({
      label: '7d',
      days: 7,
      since: new Date('2026-09-06T00:00:00Z'),
    });
  });

  it('defaults to 30 days when window is omitted or unparseable', () => {
    expect(parseStatsWindow(undefined, now)).toEqual({ label: '30d', days: 30, since: new Date('2026-08-14T00:00:00Z') });
    expect(parseStatsWindow('garbage', now)).toEqual({ label: '30d', days: 30, since: new Date('2026-08-14T00:00:00Z') });
    expect(parseStatsWindow('30days', now).days).toBe(30);
  });

  it('caps the window at maxDays', () => {
    expect(parseStatsWindow('9999d', now, 30, 365).days).toBe(365);
  });

  it('floors at 1 day', () => {
    expect(parseStatsWindow('0d', now).days).toBe(1);
  });
});

describe('fillDailyCounts', () => {
  it('spans every UTC day from since to now, zero where there were no records', () => {
    const since = new Date('2026-09-10T15:30:00Z');
    const counts = new Map([['2026-09-10', 4], ['2026-09-12', 7]]);
    expect(fillDailyCounts(since, now, counts)).toEqual([
      { day: '2026-09-10', count: 4 },
      { day: '2026-09-11', count: 0 },
      { day: '2026-09-12', count: 7 },
      { day: '2026-09-13', count: 0 },
    ]);
  });
});

describe('kpiValue', () => {
  it('reports the percent change against the prior period, to one decimal', () => {
    expect(kpiValue(110, 100)).toEqual({ value: 110, deltaPct: 10 });
    expect(kpiValue(2, 3)).toEqual({ value: 2, deltaPct: -33.3 });
    expect(kpiValue(0, 5)).toEqual({ value: 0, deltaPct: -100 });
  });

  it('has no percent change when the prior period was empty', () => {
    expect(kpiValue(7, 0)).toEqual({ value: 7, deltaPct: null });
    expect(kpiValue(0, 0)).toEqual({ value: 0, deltaPct: null });
  });
});
