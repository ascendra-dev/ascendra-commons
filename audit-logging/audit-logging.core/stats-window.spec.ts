import { describe, expect, it } from 'vitest';
import { calendarDays, fillDailyCounts, fillMonthlyCounts, isValidTimeZone, kpiValue, parseStatsWindow } from './stats-window';

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

describe('calendarDays', () => {
  it('lists the days before today and today, in UTC', () => {
    expect(calendarDays(new Date('2026-09-13T12:00:00Z'), 3, 'UTC')).toEqual([
      '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13',
    ]);
  });

  it("uses the zone's own date — ahead of UTC and behind it", () => {
    // 21:00 UTC is already the 14th in Dubai (UTC+4)…
    expect(calendarDays(new Date('2026-09-13T21:00:00Z'), 1, 'Asia/Dubai')).toEqual(['2026-09-13', '2026-09-14']);
    // …and 03:00 UTC still the 12th in Los Angeles (UTC−7).
    expect(calendarDays(new Date('2026-09-13T03:00:00Z'), 1, 'America/Los_Angeles')).toEqual(['2026-09-11', '2026-09-12']);
  });

  it('crosses a month and a DST change as plain calendar days', () => {
    expect(calendarDays(new Date('2026-11-02T12:00:00Z'), 3, 'America/New_York')).toEqual([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ]);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and UTC, rejects anything else', () => {
    expect(isValidTimeZone('Asia/Dubai')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone("UTC'; drop table x; --")).toBe(false);
  });
});

describe('fillDailyCounts', () => {
  it('gives every day its count, zero where there were no records', () => {
    const counts = new Map([['2026-09-10', 4], ['2026-09-12', 7]]);
    expect(fillDailyCounts(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'], counts)).toEqual([
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

describe('fillMonthlyCounts', () => {
  it('spans every UTC month from the first record to now, across a year end, zero on quiet months', () => {
    const counts = new Map([['2025-11', 30], ['2026-01', 12]]);
    expect(fillMonthlyCounts(new Date('2025-11-20T08:00:00Z'), new Date('2026-02-03T00:00:00Z'), counts)).toEqual([
      { month: '2025-11', count: 30 },
      { month: '2025-12', count: 0 },
      { month: '2026-01', count: 12 },
      { month: '2026-02', count: 0 },
    ]);
  });

  it('is empty with no records', () => {
    expect(fillMonthlyCounts(null, now, new Map())).toEqual([]);
  });
});
