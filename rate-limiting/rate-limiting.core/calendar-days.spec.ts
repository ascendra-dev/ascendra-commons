import { describe, expect, it } from 'vitest';
import { calendarDays, fillDailyCounts, isValidTimeZone } from './calendar-days';

describe('calendarDays', () => {
  it("ends on today's date in the viewer's zone", () => {
    // 21:30 UTC on 21 Oct is already 22 Oct in Karachi (UTC+5).
    const now = new Date('2026-10-21T21:30:00Z');
    expect(calendarDays(now, 3, 'UTC')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
    expect(calendarDays(now, 3, 'Asia/Karachi')).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });

  it('crosses a month and a DST change without skipping or repeating a day', () => {
    const days = calendarDays(new Date('2026-11-02T12:00:00Z'), 5, 'America/New_York');
    expect(days).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('fillDailyCounts / isValidTimeZone', () => {
  it('zero-fills the days a reader had nothing for', () => {
    expect(fillDailyCounts(['2026-10-20', '2026-10-21'], new Map([['2026-10-21', 7]]))).toEqual([
      { day: '2026-10-20', count: 0 },
      { day: '2026-10-21', count: 7 },
    ]);
  });

  it('knows IANA zones', () => {
    expect(isValidTimeZone('Asia/Dubai')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
