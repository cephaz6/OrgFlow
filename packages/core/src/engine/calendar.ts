// PRD.md §15.1: "businessHoursOnly: true (default) excludes weekends and
// configured organisation holidays. Business hours default 09:00-17:00 in
// the organisation's timezone."
//
// All of that is arithmetic, so it belongs here rather than anywhere that
// could reach a database. The calendar itself is organisation
// configuration, resolved by the caller and passed in, exactly as
// directory.groupIdsByKey already is.
//
// No new dependency. Timezone-correct conversion needs the IANA database
// and DST rules, and `Intl.DateTimeFormat` carries both in the runtime
// already, in Node and in the browser. Adding date-fns-tz to the one
// package CLAUDE.md §3 holds to "no I/O dependencies, ever" would be a poor
// trade for something the platform does natively.

import type { WorkingCalendar } from '@orgflow/types';

export type { WorkingCalendar };

// PRD.md §15.1's stated defaults, used when an organisation has not
// configured anything. UTC rather than a guess at the reader's zone: a
// deadline that silently depends on where the server runs is worse than one
// that is plainly UTC until somebody sets it.
export const DEFAULT_CALENDAR: WorkingCalendar = {
  timeZone: 'UTC',
  workdays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  holidays: [],
};

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  minuteOfDay: number;
}

// A calendar that never works cannot ever consume an hour, so the walk
// below would run forever. Ten years of days is far past any real SLA and
// still terminates promptly.
const MAX_DAYS_SEARCHED = 3650;

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// The instant, as somebody in that timezone would read it off a clock.
function toWallClock(instant: Date, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };

  // 'en-GB' renders midnight as 24 rather than 00 in some runtimes, which
  // would otherwise put midnight at the end of the wrong day.
  const hour = value('hour') % 24;

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    minuteOfDay: hour * 60 + value('minute'),
  };
}

// Wall clock back to an instant. The offset of a zone depends on the
// instant, and the instant is what is being solved for, so this guesses,
// measures the error, and corrects. Twice, because a guess that lands on
// the far side of a DST transition has a different offset again.
function toInstant(wall: WallClock, timeZone: string): Date {
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    Math.floor(wall.minuteOfDay / 60),
    wall.minuteOfDay % 60,
  );

  let instant = new Date(asUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const rendered = toWallClock(instant, timeZone);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      Math.floor(rendered.minuteOfDay / 60),
      rendered.minuteOfDay % 60,
    );
    const drift = asUtc - renderedAsUtc;
    if (drift === 0) {
      return instant;
    }
    instant = new Date(instant.getTime() + drift);
  }

  // Reached when the wall clock does not exist, which happens for the hour
  // a spring-forward skips. The instant here is the moment the clocks
  // jumped, which is the first real time at or after what was asked for,
  // and is the answer a deadline wants.
  return instant;
}

function isoDate(wall: WallClock): string {
  const month = String(wall.month).padStart(2, '0');
  const day = String(wall.day).padStart(2, '0');
  return `${wall.year}-${month}-${day}`;
}

// Day of week for a wall-clock date, via a UTC date built from the same
// numbers: the weekday of 2026-09-02 is a property of the date, not of any
// timezone it might be read in.
function weekdayOf(wall: WallClock): number {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
}

export function isWorkingDay(wall: WallClock, calendar: WorkingCalendar): boolean {
  return calendar.workdays.includes(weekdayOf(wall)) && !calendar.holidays.includes(isoDate(wall));
}

function addDays(wall: WallClock, days: number): WallClock {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    minuteOfDay: wall.minuteOfDay,
  };
}

// The first working minute at or after this wall clock. A time before the
// working day starts waits for it; a time after it ends, or on a day that
// is not worked, moves to the next day that is.
function advanceToWorkingTime(wall: WallClock, calendar: WorkingCalendar): WallClock | null {
  let cursor = wall;

  for (let day = 0; day <= MAX_DAYS_SEARCHED; day += 1) {
    if (isWorkingDay(cursor, calendar)) {
      if (cursor.minuteOfDay < calendar.startMinute) {
        return { ...cursor, minuteOfDay: calendar.startMinute };
      }
      if (cursor.minuteOfDay < calendar.endMinute) {
        return cursor;
      }
    }
    cursor = { ...addDays(cursor, 1), minuteOfDay: 0 };
  }

  return null;
}

// PRD.md §15.1's calculation: durationHours are *working* hours, consumed
// only inside the working window, so eight hours from 16:00 on a Friday
// lands at 15:00 on Monday rather than at midnight on Saturday.
//
// Returns null when the calendar can never consume the duration, which
// means it has no working days at all. The caller treats that as no
// deadline rather than inventing one.
export function addWorkingHours(
  start: Date,
  durationHours: number,
  calendar: WorkingCalendar,
): Date | null {
  if (calendar.endMinute <= calendar.startMinute || calendar.workdays.length === 0) {
    return null;
  }

  let remaining = Math.round(durationHours * 60);
  let cursor = advanceToWorkingTime(toWallClock(start, calendar.timeZone), calendar);
  if (cursor === null) {
    return null;
  }

  // A zero-length SLA is due the moment work could next begin on it, which
  // is what the loop below would produce anyway; returning early keeps it
  // from depending on that.
  if (remaining <= 0) {
    return toInstant(cursor, calendar.timeZone);
  }

  for (let day = 0; day <= MAX_DAYS_SEARCHED; day += 1) {
    const minutesLeftToday = calendar.endMinute - cursor.minuteOfDay;

    if (remaining <= minutesLeftToday) {
      return toInstant(
        { ...cursor, minuteOfDay: cursor.minuteOfDay + remaining },
        calendar.timeZone,
      );
    }

    remaining -= minutesLeftToday;
    const next = advanceToWorkingTime({ ...addDays(cursor, 1), minuteOfDay: 0 }, calendar);
    if (next === null) {
      return null;
    }
    cursor = next;
  }

  return null;
}

// Whole calendar time, for a step that opted out of business hours. Kept
// here beside its counterpart so the two readings of "durationHours" sit
// together rather than in different files.
export function addCalendarHours(start: Date, durationHours: number): Date {
  return new Date(start.getTime() + durationHours * 60 * 60 * 1000);
}
