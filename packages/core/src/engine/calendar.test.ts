import { describe, expect, it } from 'vitest';

import {
  addCalendarHours,
  addWorkingHours,
  DEFAULT_CALENDAR,
  type WorkingCalendar,
} from './calendar.js';

// A working week of 09:00-17:00, eight hours a day, in London, so that
// British Summer Time is in play for half the year and the tests can say
// what should happen across the switch.
const LONDON: WorkingCalendar = {
  ...DEFAULT_CALENDAR,
  timeZone: 'Europe/London',
};

function at(iso: string): Date {
  return new Date(iso);
}

function result(start: string, hours: number, calendar: WorkingCalendar = LONDON): string {
  const due = addWorkingHours(at(start), hours, calendar);
  expect(due, 'expected a deadline').not.toBeNull();
  return due!.toISOString();
}

describe('addWorkingHours within one day', () => {
  it('consumes hours inside the working window', () => {
    // Wednesday 2026-09-02, 09:00 UTC is 10:00 in London (BST).
    expect(result('2026-09-02T09:00:00.000Z', 3)).toBe('2026-09-02T12:00:00.000Z');
  });

  it('starts the clock at opening time when work arrives before it', () => {
    // 05:00 UTC is 06:00 London, three hours before the day starts, so the
    // first hour is not consumed until 09:00 London (08:00 UTC).
    expect(result('2026-09-02T05:00:00.000Z', 1)).toBe('2026-09-02T09:00:00.000Z');
  });

  it('carries into the next day when the window runs out', () => {
    // 15:00 London Wednesday, two hours left that day, so six hours lands
    // at 13:00 London Thursday.
    expect(result('2026-09-02T14:00:00.000Z', 6)).toBe('2026-09-03T12:00:00.000Z');
  });
});

describe('addWorkingHours across non-working time', () => {
  it('skips the weekend', () => {
    // Friday 2026-09-04, 15:00 London. Two hours remain on Friday, so four
    // working hours reach 11:00 London on Monday the 7th.
    expect(result('2026-09-04T14:00:00.000Z', 4)).toBe('2026-09-07T10:00:00.000Z');
  });

  it('treats work arriving on a Saturday as starting Monday morning', () => {
    // Monday opens at 09:00 London, which is 08:00 UTC in BST, so the one
    // hour runs 09:00 to 10:00 London and the deadline is 09:00 UTC.
    expect(result('2026-09-05T11:00:00.000Z', 1)).toBe('2026-09-07T09:00:00.000Z');
  });

  it('skips a configured holiday, which a weekend rule alone would not', () => {
    // Monday the 7th declared a holiday, so Friday afternoon's work
    // continues on Tuesday the 8th instead.
    const withHoliday: WorkingCalendar = { ...LONDON, holidays: ['2026-09-07'] };
    expect(result('2026-09-04T14:00:00.000Z', 4, withHoliday)).toBe('2026-09-08T10:00:00.000Z');
  });

  it('skips several consecutive holidays', () => {
    const christmas: WorkingCalendar = {
      ...LONDON,
      holidays: ['2026-12-25', '2026-12-28', '2026-12-29'],
    };
    // Thursday 24 December, 16:00 London (GMT in winter): one hour left
    // that day, then the 25th, the weekend, and two more holidays. The
    // second hour is worked from 09:00 to 10:00 on Wednesday the 30th.
    expect(result('2026-12-24T16:00:00.000Z', 2, christmas)).toBe('2026-12-30T10:00:00.000Z');
  });

  it('spans a long duration across many weeks', () => {
    // Ten working days of eight hours, from Monday opening, is a fortnight
    // later at closing time.
    expect(result('2026-09-07T08:00:00.000Z', 80)).toBe('2026-09-18T16:00:00.000Z');
  });
});

describe('addWorkingHours across a daylight saving change', () => {
  it('keeps the wall-clock working day when the clocks go back', () => {
    // The UK returns to GMT on Sunday 2026-10-25. Friday the 23rd at 15:00
    // London (14:00 UTC) plus four working hours is 11:00 London on Monday
    // the 26th, which is 11:00 UTC now that BST has ended, not 10:00.
    expect(result('2026-10-23T14:00:00.000Z', 4)).toBe('2026-10-26T11:00:00.000Z');
  });

  it('keeps the wall-clock working day when the clocks go forward', () => {
    // BST begins Sunday 2026-03-29. Friday the 27th at 15:00 London
    // (15:00 UTC, still GMT) plus four working hours is 11:00 London on
    // Monday the 30th, which is 10:00 UTC.
    expect(result('2026-03-27T15:00:00.000Z', 4)).toBe('2026-03-30T10:00:00.000Z');
  });
});

describe('addWorkingHours in other timezones', () => {
  it('honours a timezone well away from UTC', () => {
    const tokyo: WorkingCalendar = { ...DEFAULT_CALENDAR, timeZone: 'Asia/Tokyo' };
    // 2026-09-02 00:30 UTC is 09:30 in Tokyo, so two hours lands at 11:30
    // Tokyo, which is 02:30 UTC.
    expect(result('2026-09-02T00:30:00.000Z', 2, tokyo)).toBe('2026-09-02T02:30:00.000Z');
  });

  it('honours a half-hour offset zone', () => {
    const kolkata: WorkingCalendar = { ...DEFAULT_CALENDAR, timeZone: 'Asia/Kolkata' };
    // 09:00 in Kolkata is 03:30 UTC; one hour later is 04:30 UTC.
    expect(result('2026-09-02T03:30:00.000Z', 1, kolkata)).toBe('2026-09-02T04:30:00.000Z');
  });
});

describe('addWorkingHours with an unusual working week', () => {
  it('supports a week that includes the weekend and excludes a weekday', () => {
    // Saturday to Wednesday, which is a normal week in much of the world.
    const gulf: WorkingCalendar = { ...DEFAULT_CALENDAR, workdays: [0, 1, 2, 3, 6] };
    // This calendar is in UTC, not London. Thursday 2026-09-03 is not
    // worked, nor is Friday, so the hour is worked 09:00 to 10:00 UTC on
    // Saturday the 5th.
    expect(result('2026-09-03T08:00:00.000Z', 1, gulf)).toBe('2026-09-05T10:00:00.000Z');
  });

  it('supports a shorter working day', () => {
    const shortDay: WorkingCalendar = { ...DEFAULT_CALENDAR, startMinute: 600, endMinute: 840 };
    // 10:00 to 14:00 is four hours a day, so six hours is one full day plus
    // two hours of the next.
    expect(result('2026-09-02T10:00:00.000Z', 6, shortDay)).toBe('2026-09-03T12:00:00.000Z');
  });
});

describe('addWorkingHours edge cases', () => {
  it('is due at the next working minute when the duration is zero', () => {
    expect(result('2026-09-05T11:00:00.000Z', 0)).toBe('2026-09-07T08:00:00.000Z');
  });

  it('returns null rather than looping when no day is ever worked', () => {
    const never: WorkingCalendar = { ...DEFAULT_CALENDAR, workdays: [] };
    expect(addWorkingHours(at('2026-09-02T09:00:00.000Z'), 1, never)).toBeNull();
  });

  it('returns null when the working day has no length', () => {
    const empty: WorkingCalendar = { ...DEFAULT_CALENDAR, startMinute: 540, endMinute: 540 };
    expect(addWorkingHours(at('2026-09-02T09:00:00.000Z'), 1, empty)).toBeNull();
  });

  it('returns null when every day within reach is a holiday', () => {
    // Not realistic, but it is the shape of a misconfiguration, and looping
    // forever is the failure worth ruling out.
    const holidays = Array.from({ length: 4000 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 8, 2 + index));
      return day.toISOString().slice(0, 10);
    });
    expect(addWorkingHours(at('2026-09-02T09:00:00.000Z'), 1, { ...LONDON, holidays })).toBeNull();
  });
});

describe('addCalendarHours', () => {
  it('adds whole hours regardless of the calendar', () => {
    // What businessHoursOnly: false means: a deadline that runs overnight
    // and through the weekend.
    expect(addCalendarHours(at('2026-09-04T14:00:00.000Z'), 48).toISOString()).toBe(
      '2026-09-06T14:00:00.000Z',
    );
  });
});
