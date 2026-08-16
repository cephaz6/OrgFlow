import type { StatusTone } from '@orgflow/ui';
import { AlertTriangle, CalendarClock, CircleDot, Infinity as InfinityIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { Urgency } from './urgency';

// Kept out of urgency.ts so that module stays pure logic with pure unit
// tests, and kept out of approval-queue.tsx so the dashboard's compact list
// and the full queue cannot drift into showing the same urgency two
// different ways.
//
// Every entry pairs a tone with an icon, and urgencyOf always returns a
// text label alongside: PRD.md §13.2 requires this indicator to be icon
// plus text, never colour alone, and this is the screen where getting that
// wrong costs the most.
export const URGENCY_PRESENTATION: Record<Urgency, { tone: StatusTone; icon: LucideIcon }> = {
  overdue: { tone: 'danger', icon: AlertTriangle },
  dueSoon: { tone: 'warning', icon: CalendarClock },
  onTrack: { tone: 'neutral', icon: CircleDot },
  noDeadline: { tone: 'neutral', icon: InfinityIcon },
};
