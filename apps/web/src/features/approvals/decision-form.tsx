'use client';

import type { WorkflowDecisionAction } from '@orgflow/types';
import { Alert, Button, Label, Textarea } from '@orgflow/ui';
import { CheckCircle2, Undo2, XCircle, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { claimTask, decideTask } from './api-client';

export interface DecisionFormProps {
  taskId: string;
  reference: string;
  allowedDecisions: WorkflowDecisionAction[];
  requireCommentOn: WorkflowDecisionAction[];
  // False when the task sits in a pool nobody has taken. Claiming is a
  // separate act from deciding (PRD.md §7, first to claim owns it), so the
  // screen asks for it rather than claiming silently on arrival, which
  // would take work off a colleague's queue just because somebody looked.
  isClaimed: boolean;
  canAct: boolean;
  cannotActReason?: string;
}

interface Presentation {
  label: string;
  icon: LucideIcon;
  variant: 'default' | 'destructive' | 'outline';
  // Irreversible decisions get a confirmation step (PRD.md §13.2).
  confirm: string | null;
}

const DECISIONS: Record<WorkflowDecisionAction, Presentation> = {
  approve: {
    label: 'Approve',
    icon: CheckCircle2,
    variant: 'default',
    confirm: 'Approving moves this request to the next step. You cannot undo it.',
  },
  reject: {
    label: 'Reject',
    icon: XCircle,
    variant: 'destructive',
    confirm: 'Rejecting closes this request for good. It cannot be reopened.',
  },
  return: {
    label: 'Return for amendment',
    icon: Undo2,
    variant: 'outline',
    // Returning is the one decision the requester can undo, by amending and
    // resubmitting, so it does not need a confirmation step.
    confirm: null,
  },
  complete: {
    label: 'Mark as done',
    icon: CheckCircle2,
    variant: 'default',
    confirm: 'Completing this step moves the request on. You cannot undo it.',
  },
};

type Phase =
  | { kind: 'choosing' }
  | { kind: 'confirming'; decision: WorkflowDecisionAction }
  | { kind: 'working' }
  | { kind: 'failed'; message: string };

export function DecisionForm({
  taskId,
  reference,
  allowedDecisions,
  requireCommentOn,
  isClaimed,
  canAct,
  cannotActReason,
}: DecisionFormProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing' });
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);

  if (!canAct) {
    return (
      <Alert>
        {cannotActReason ?? 'This task is not yours to decide.'} You can see it because you can see
        the request behind it.
      </Alert>
    );
  }

  if (!isClaimed) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Nobody has taken this yet. Claiming it makes it yours and removes it from everyone
          else&apos;s available list.
        </p>
        {phase.kind === 'failed' ? <Alert variant="destructive">{phase.message}</Alert> : null}
        <Button
          type="button"
          disabled={phase.kind === 'working'}
          onClick={() => {
            setPhase({ kind: 'working' });
            void claimTask(taskId)
              .then(() => {
                router.refresh();
                setPhase({ kind: 'choosing' });
              })
              .catch((err: unknown) =>
                setPhase({
                  kind: 'failed',
                  message:
                    err instanceof Error
                      ? err.message
                      : 'The task could not be claimed. Somebody may have taken it first.',
                }),
              );
          }}
        >
          {phase.kind === 'working' ? 'Claiming...' : 'Claim this task'}
        </Button>
      </div>
    );
  }

  function submit(decision: WorkflowDecisionAction) {
    // The definition decides which outcomes need an explanation, so this is
    // read from requireCommentOn rather than assumed. Checking it here
    // rather than letting the API's 400 surface means the approver is told
    // before they commit to the decision, not after.
    if (requireCommentOn.includes(decision) && comment.trim().length === 0) {
      setCommentError(
        `Explain why you are choosing to ${DECISIONS[decision].label.toLowerCase()}.`,
      );
      setPhase({ kind: 'choosing' });
      return;
    }

    setCommentError(null);
    setPhase({ kind: 'working' });

    void decideTask(taskId, decision, comment.trim() || undefined)
      .then(() => {
        router.push('/approvals');
        router.refresh();
      })
      .catch((err: unknown) =>
        setPhase({
          kind: 'failed',
          message:
            err instanceof Error
              ? err.message
              : 'The decision could not be recorded. Reload and try again.',
        }),
      );
  }

  if (phase.kind === 'confirming') {
    const chosen = DECISIONS[phase.decision];
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <p className="text-sm">
          {chosen.confirm} This applies to <span className="font-mono">{reference}</span>.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant={chosen.variant} onClick={() => submit(phase.decision)}>
            Yes, {chosen.label.toLowerCase()}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setPhase({ kind: 'choosing' })}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="decision-comment">
          Comment
          {requireCommentOn.length > 0 ? (
            <span className="text-muted-foreground">
              {' '}
              (required to{' '}
              {requireCommentOn
                .map((decision) => DECISIONS[decision].label.toLowerCase())
                .join(' or ')}
              )
            </span>
          ) : (
            <span className="text-muted-foreground"> (optional)</span>
          )}
        </Label>
        <Textarea
          id="decision-comment"
          value={comment}
          aria-invalid={commentError ? true : undefined}
          aria-describedby={commentError ? 'decision-comment-error' : undefined}
          onChange={(event) => setComment(event.target.value)}
        />
        {commentError ? (
          <p
            id="decision-comment-error"
            role="alert"
            className="text-sm text-destructive-subtle-foreground"
          >
            {commentError}
          </p>
        ) : null}
      </div>

      {phase.kind === 'failed' ? <Alert variant="destructive">{phase.message}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {allowedDecisions.map((decision) => {
          const presentation = DECISIONS[decision];
          const Icon = presentation.icon;

          return (
            <Button
              key={decision}
              type="button"
              variant={presentation.variant}
              disabled={phase.kind === 'working'}
              onClick={() =>
                presentation.confirm ? setPhase({ kind: 'confirming', decision }) : submit(decision)
              }
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {presentation.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
