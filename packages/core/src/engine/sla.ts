import type { SlaConfig, TimerSpec, WorkingCalendar } from '@orgflow/types';

import { addCalendarHours, addWorkingHours, DEFAULT_CALENDAR } from './calendar.js';

// PRD.md §15.1: durationHours are working hours when businessHoursOnly is
// set (the default), consumed only inside the organisation's working
// window, skipping weekends and its configured holidays. So eight hours
// raised at 16:00 on a Friday is due at 15:00 on Monday, not at midnight on
// Saturday.
//
// businessHoursOnly: false means whole calendar time, for a process where
// the clock genuinely does run overnight.
//
// The value is persisted at task creation and never recomputed, so neither
// a later definition change nor a later change to the organisation's
// calendar shifts an existing task's deadline (PRD.md §15.1). That is why
// the calendar is an input here rather than something looked up at read
// time: the deadline a task was given is the deadline it keeps.
export function computeDueAt(
  sla: SlaConfig | undefined,
  now: string,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
): string | null {
  if (!sla || typeof sla.durationHours !== 'number') {
    return null;
  }

  const start = new Date(now);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  if (sla.businessHoursOnly === false) {
    return addCalendarHours(start, sla.durationHours).toISOString();
  }

  // Null when the calendar could never consume the duration, which means it
  // has no working days or no working day length. A step with no reachable
  // deadline is better than one invented from a broken calendar, and the
  // caller already handles a task without a dueAt.
  const due = addWorkingHours(start, sla.durationHours, calendar);
  return due ? due.toISOString() : null;
}

// PRD.md §15.2: one `reminder` timer per configured `atHoursBefore`, one
// `escalation` timer per configured `atHoursAfter`, both measured from
// `dueAt` (confirmed against the Laptop Request seed's own
// `escalation: [{ atHoursAfter: 24 }, ...]` against `durationHours: 48`,
// the same relationship `reminders`' `atHoursBefore` has to it). `expiry`
// is deliberately not produced here: it needs an `onExpiry` field nothing
// in the schema defines yet, and a timer this function invented a decision
// for would be worse than one that does not exist.
export function computeTimerSpecs(sla: SlaConfig | undefined, dueAt: string | null): TimerSpec[] {
  if (!sla || !dueAt) {
    return [];
  }

  const dueTime = new Date(dueAt).getTime();
  if (Number.isNaN(dueTime)) {
    return [];
  }

  const specs: TimerSpec[] = [];

  for (const reminder of sla.reminders ?? []) {
    specs.push({
      timerType: 'reminder',
      escalationLevel: 0,
      fireAt: new Date(dueTime - reminder.atHoursBefore * 60 * 60 * 1000).toISOString(),
    });
  }

  (sla.escalation ?? []).forEach((rule, index) => {
    specs.push({
      timerType: 'escalation',
      escalationLevel: index + 1,
      fireAt: new Date(dueTime + rule.atHoursAfter * 60 * 60 * 1000).toISOString(),
    });
  });

  return specs;
}
