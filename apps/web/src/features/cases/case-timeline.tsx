import type { ProcessDefinitionDocument } from '@orgflow/types';
import {
  Ban,
  CheckCircle2,
  CircleDot,
  FileText,
  Send,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { TimelineEntry } from './types';
import { formatDateTime } from '../../lib/format';

export interface CaseTimelineProps {
  entries: TimelineEntry[];
  document: ProcessDefinitionDocument;
}

const TERMINAL_STEP_LABELS: Record<string, string> = {
  $completed: 'Completed',
  $rejected: 'Rejected',
  $cancelled: 'Cancelled',
  $returnedToRequester: 'Returned to the requester',
};

interface Rendered {
  icon: LucideIcon;
  title: string;
  detail: string | null;
}

// The audit actions worth showing a requester. The rest of the audit trail
// is real and retained, but a timeline that narrates every row is a log,
// not a history: PRD.md §13.2 asks for what happened to the request, and
// the transition and decision entries already carry most of that.
const AUDIT_TITLES: Record<string, string> = {
  'case.submitted': 'Request submitted',
  'case.resubmitted': 'Request amended and resubmitted',
  'case.cancelled': 'Request cancelled',
};

function stepName(document: ProcessDefinitionDocument, key: string | null): string {
  if (key === null) {
    return 'the start';
  }
  return (
    TERMINAL_STEP_LABELS[key] ??
    document.workflow.steps.find((step) => step.key === key)?.name ??
    key
  );
}

function render(entry: TimelineEntry, document: ProcessDefinitionDocument): Rendered | null {
  switch (entry.kind) {
    case 'decision': {
      const icons: Record<string, LucideIcon> = {
        approved: CheckCircle2,
        completed: CheckCircle2,
        rejected: XCircle,
        returned: Undo2,
      };
      const verbs: Record<string, string> = {
        approved: 'approved',
        completed: 'completed',
        rejected: 'rejected',
        returned: 'returned for amendment',
      };
      return {
        icon: icons[entry.decision] ?? CircleDot,
        title: `${entry.stepName} ${verbs[entry.decision] ?? entry.decision}`,
        detail: entry.comment,
      };
    }

    case 'transition':
      return {
        icon: entry.fromStepKey === null ? Send : CircleDot,
        title:
          entry.fromStepKey === null
            ? `Started at ${stepName(document, entry.toStepKey)}`
            : `Moved to ${stepName(document, entry.toStepKey)}`,
        detail: null,
      };

    case 'audit': {
      const title = AUDIT_TITLES[entry.action];
      if (!title) {
        return null;
      }
      const reason = typeof entry.payload.reason === 'string' ? entry.payload.reason : null;
      return { icon: entry.action === 'case.cancelled' ? Ban : FileText, title, detail: reason };
    }
  }
}

// Submission writes the audit row, the transition and the task within one
// transaction, so they frequently share a timestamp to the millisecond and
// the API cannot order them meaningfully by time alone. Without a tiebreak
// the history reads "started at Line manager approval" before "request
// submitted", which is the wrong way round. This orders equal timestamps by
// what caused what: the person's action, then the movement it caused, then
// the decision recorded against it.
const KIND_ORDER: Record<TimelineEntry['kind'], number> = {
  audit: 0,
  transition: 1,
  decision: 2,
};

export function CaseTimeline({ entries, document }: CaseTimelineProps) {
  const rendered = [...entries]
    .sort((a, b) =>
      a.occurredAt === b.occurredAt
        ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
        : a.occurredAt.localeCompare(b.occurredAt),
    )
    .map((entry) => ({ entry, view: render(entry, document) }))
    .filter((row): row is { entry: TimelineEntry; view: Rendered } => row.view !== null);

  return (
    // An ordered list, because the sequence is the information, and <time>
    // so the timestamps are machine-readable as well as legible.
    <ol className="flex flex-col">
      {rendered.map(({ entry, view }, index) => {
        const Icon = view.icon;
        return (
          <li
            key={`${entry.kind}-${entry.occurredAt}-${index}`}
            className="flex gap-3 border-b border-divider py-3 last:border-b-0"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm font-medium">{view.title}</span>
              {view.detail ? (
                <span className="text-sm text-muted-foreground">{view.detail}</span>
              ) : null}
            </span>
            <time dateTime={entry.occurredAt} className="shrink-0 text-xs text-muted-foreground">
              {formatDateTime(entry.occurredAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
