'use client';

import { Alert, Button, Label, Textarea } from '@orgflow/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { cancelCase } from './api-client';

export interface CancelCaseProps {
  caseId: string;
  reference: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'working' }
  | { kind: 'failed'; message: string };

// PRD.md §13.2 requires a confirmation step for irreversible decisions, and
// cancelling is irreversible: there is no un-cancel, the case reaches a
// terminal state and its open tasks are cancelled with it. The reason is
// mandatory because the API requires one, and asking for it here rather
// than discovering the 400 afterwards is the difference between a form and
// a trap.
export function CancelCase({ caseId, reference }: CancelCaseProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  async function onConfirm() {
    if (reason.trim().length === 0) {
      setReasonError('Give a reason for cancelling this request.');
      return;
    }

    setReasonError(null);
    setStatus({ kind: 'working' });

    try {
      await cancelCase(caseId, reason.trim());
      // Refreshes the server components rather than patching local state,
      // so the status badge, the timeline and the available actions all
      // come from the same server render and cannot disagree.
      router.refresh();
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'The request could not be cancelled.',
      });
    }
  }

  if (status.kind === 'idle') {
    return (
      <Button type="button" variant="outline" onClick={() => setStatus({ kind: 'confirming' })}>
        Cancel this request
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <p className="text-sm">
        Cancelling {reference} closes it for good. It cannot be reopened, and anyone waiting to
        approve it will no longer be asked to.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="cancel-reason">Why are you cancelling it?</Label>
        <Textarea
          id="cancel-reason"
          value={reason}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? 'cancel-reason-error' : undefined}
          onChange={(event) => setReason(event.target.value)}
        />
        {reasonError ? (
          <p
            id="cancel-reason-error"
            role="alert"
            className="text-sm text-destructive-subtle-foreground"
          >
            {reasonError}
          </p>
        ) : null}
      </div>

      {status.kind === 'failed' ? <Alert variant="destructive">{status.message}</Alert> : null}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={status.kind === 'working'}
          onClick={() => void onConfirm()}
        >
          {status.kind === 'working' ? 'Cancelling...' : 'Yes, cancel it'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={status.kind === 'working'}
          onClick={() => setStatus({ kind: 'idle' })}
        >
          Keep it open
        </Button>
      </div>
    </div>
  );
}
