export type Urgency = 'overdue' | 'dueSoon' | 'onTrack' | 'noDeadline';

export interface UrgencyView {
  urgency: Urgency;
  // Always a phrase, never a colour. PRD.md §13.2 is explicit that the
  // approval queue's urgency indicator is icon plus text and never colour
  // alone, and this is the highest-value screen in the product, so it is
  // the worst place to get that wrong.
  label: string;
}

const HOUR = 60 * 60 * 1000;
const DUE_SOON_HOURS = 24;

// Whole days, rounded away from zero, so "in 0 days" never appears: a
// deadline later today is "today", and one an hour ago is "1 day overdue"
// rather than "0 days overdue".
function days(milliseconds: number): number {
  return Math.max(1, Math.round(milliseconds / (24 * HOUR)));
}

export function urgencyOf(dueAt: string | null, now: Date): UrgencyView {
  if (!dueAt) {
    return { urgency: 'noDeadline', label: 'No deadline' };
  }

  const remaining = new Date(dueAt).getTime() - now.getTime();

  if (remaining < 0) {
    const overdueBy = -remaining;
    return {
      urgency: 'overdue',
      label: overdueBy < 24 * HOUR ? 'Overdue today' : `Overdue by ${days(overdueBy)} days`,
    };
  }

  if (remaining <= DUE_SOON_HOURS * HOUR) {
    return { urgency: 'dueSoon', label: 'Due today' };
  }

  return { urgency: 'onTrack', label: `Due in ${days(remaining)} days` };
}

// Overdue first, then by deadline, then everything without one. A queue
// that sorts by creation date buries the thing that is late, which is the
// only ordering an approver actually needs (PRD.md §13.2).
export function byUrgency<T extends { dueAt: string | null; createdAt: string }>(
  entries: T[],
): T[] {
  return [...entries].sort((a, b) => {
    if (a.dueAt && b.dueAt) {
      return a.dueAt.localeCompare(b.dueAt);
    }
    if (a.dueAt) {
      return -1;
    }
    if (b.dueAt) {
      return 1;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });
}
