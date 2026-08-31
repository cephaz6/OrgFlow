import type { CaseOutcome, CaseStatus, TaskStatus } from '@orgflow/types';
import { StatusBadge, type StatusTone } from '@orgflow/ui';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  FileEdit,
  Undo2,
  UserX,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

interface Presentation {
  tone: StatusTone;
  icon: LucideIcon;
  label: string;
}

// Outcome is checked before status, because status alone under-describes a
// finished case: `completed` covers both an approval and a rejection, and
// telling a requester their rejected request is "completed" is worse than
// saying nothing.
const OUTCOMES: Record<CaseOutcome, Presentation> = {
  approved: { tone: 'success', icon: CheckCircle2, label: 'Approved' },
  rejected: { tone: 'danger', icon: XCircle, label: 'Rejected' },
  cancelled: { tone: 'neutral', icon: Ban, label: 'Cancelled' },
  withdrawn: { tone: 'neutral', icon: Ban, label: 'Withdrawn' },
};

const STATUSES: Record<CaseStatus, Presentation> = {
  draft: { tone: 'neutral', icon: FileEdit, label: 'Draft' },
  active: { tone: 'info', icon: CircleDot, label: 'In progress' },
  completed: { tone: 'success', icon: CheckCircle2, label: 'Completed' },
  rejected: { tone: 'danger', icon: XCircle, label: 'Rejected' },
  cancelled: { tone: 'neutral', icon: Ban, label: 'Cancelled' },
  // PRD.md §7: a step whose assignment strategy resolved to nobody. It is a
  // warning rather than an error, because the case is not broken, it is
  // waiting for somebody to be found.
  unassigned: { tone: 'warning', icon: UserX, label: 'Waiting for an assignee' },
};

export function caseStatusPresentation(
  status: CaseStatus,
  outcome: CaseOutcome | null,
): Presentation {
  return (outcome ? OUTCOMES[outcome] : undefined) ?? STATUSES[status];
}

// For a status filter control (the case list's own): the same labels the
// badge itself renders, derived rather than duplicated, so the two can
// never drift apart. Outcome is deliberately not folded in here: filtering
// is against the stored status column, which is what the API's own
// ?status= query param matches against.
export const CASE_STATUS_OPTIONS: { status: CaseStatus; label: string }[] = (
  Object.entries(STATUSES) as [CaseStatus, Presentation][]
).map(([status, presentation]) => ({ status, label: presentation.label }));

export interface CaseStatusBadgeProps {
  status: CaseStatus;
  outcome: CaseOutcome | null;
  // True when the case is sitting on the requester's own amendment step,
  // which no status value distinguishes: a returned case is `active` with
  // no current step, and telling the requester "in progress" would hide
  // the fact that it is waiting on them.
  returnedToRequester?: boolean;
}

export function CaseStatusBadge({ status, outcome, returnedToRequester }: CaseStatusBadgeProps) {
  if (returnedToRequester) {
    return <StatusBadge tone="warning" icon={Undo2} label="Returned to you" />;
  }

  const { tone, icon, label } = caseStatusPresentation(status, outcome);
  return <StatusBadge tone={tone} icon={icon} label={label} />;
}

const TASK_STATUSES: Record<TaskStatus, Presentation> = {
  pending: { tone: 'info', icon: CircleDot, label: 'Waiting' },
  claimed: { tone: 'info', icon: CircleDot, label: 'Claimed' },
  completed: { tone: 'success', icon: CheckCircle2, label: 'Done' },
  skipped: { tone: 'neutral', icon: CircleDashed, label: 'Skipped' },
  reassigned: { tone: 'neutral', icon: CircleDashed, label: 'Reassigned' },
  cancelled: { tone: 'neutral', icon: Ban, label: 'Cancelled' },
  expired: { tone: 'warning', icon: CircleDashed, label: 'Expired' },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { tone, icon, label } = TASK_STATUSES[status];
  return <StatusBadge tone={tone} icon={icon} label={label} />;
}
