import type { SlaConfig, TimerSpec } from '@orgflow/types';

// PRD.md §15 computes due_at from durationHours, excluding weekends and
// configured holidays when businessHoursOnly is set.
//
// Weekends only, not full business hours: organisation timezone, a working-
// hours window and a holiday calendar are still not modelled (none of that
// exists in the schema yet), so this advances whole SLA-hours across
// calendar time and then skips forward over any Saturday/Sunday the result
// lands on. That is honest about what it is, "excluding weekends," not
// "excluding weekends and holidays, in the organisation's own working day",
// rather than looking like the full PRD.md §15.1 calculation while
// quietly being wrong about holidays and time zones.
//
// The value is persisted at task creation and never recomputed, so a
// definition change later does not shift an existing task's deadline
// (PRD.md §15).
export function computeDueAt(sla: SlaConfig | undefined, now: string): string | null {
  if (!sla || typeof sla.durationHours !== 'number') {
    return null;
  }

  const start = new Date(now);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  let due = new Date(start.getTime() + sla.durationHours * 60 * 60 * 1000);

  if (sla.businessHoursOnly !== false) {
    due = skipWeekend(due);
  }

  return due.toISOString();
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// Advances a date forward, one day at a time, until it no longer lands on a
// Saturday or Sunday (UTC day-of-week, the same clock everything else in
// the engine already runs on). A due date is never moved backward: skipping
// forward is what "excluding weekends" means for a deadline.
function skipWeekend(date: Date): Date {
  let result = date;
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) {
    result = new Date(result.getTime() + MILLISECONDS_PER_DAY);
  }
  return result;
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
