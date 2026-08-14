import type { SlaConfig } from '@orgflow/types';

// PRD.md §15 computes due_at from durationHours, excluding weekends and
// configured holidays when businessHoursOnly is set.
//
// Phase 1 computes elapsed hours only. Business-hours arithmetic needs the
// organisation's timezone, working hours and holiday calendar, none of
// which are modelled yet; they arrive with reminders and escalation in
// Phase 6. Implementing half of it now would produce a due date that looks
// authoritative and is quietly wrong, which is worse than an obviously
// simple one.
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

  return new Date(start.getTime() + sla.durationHours * 60 * 60 * 1000).toISOString();
}
