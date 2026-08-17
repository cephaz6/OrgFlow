'use client';

import { Alert, Button, Input, Label, Textarea } from '@orgflow/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createDelegation } from './api-client';

type Phase = { kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; message: string };

// Out-of-office cover (PRD.md §7): whoever is delegated to sees the task
// alongside the original assignee, so this form only needs enough to
// resolve who and when, not a separate approval step of its own.
export function DelegationForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [toUserEmail, setToUserEmail] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!startsAt || !endsAt) {
      setPhase({ kind: 'failed', message: 'Choose a start and an end date.' });
      return;
    }

    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (end <= start) {
      setPhase({ kind: 'failed', message: 'The end date must be after the start date.' });
      return;
    }

    setPhase({ kind: 'working' });

    const trimmedReason = reason.trim();

    void createDelegation({
      toUserEmail: toUserEmail.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      ...(trimmedReason ? { reason: trimmedReason } : {}),
    })
      .then(() => {
        setToUserEmail('');
        setStartsAt('');
        setEndsAt('');
        setReason('');
        setPhase({ kind: 'idle' });
        router.refresh();
      })
      .catch((err: unknown) =>
        setPhase({
          kind: 'failed',
          message:
            err instanceof Error
              ? err.message
              : 'The delegation could not be created. Check the details and try again.',
        }),
      );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="delegate-email">Delegate to</Label>
        <Input
          id="delegate-email"
          type="email"
          required
          placeholder="colleague@example.com"
          value={toUserEmail}
          onChange={(event) => setToUserEmail(event.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="delegate-starts-at">Starts</Label>
          <Input
            id="delegate-starts-at"
            type="datetime-local"
            required
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="delegate-ends-at">Ends</Label>
          <Input
            id="delegate-ends-at"
            type="datetime-local"
            required
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="delegate-reason">
          Reason <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="delegate-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      {phase.kind === 'failed' ? <Alert variant="destructive">{phase.message}</Alert> : null}

      <div>
        <Button type="submit" disabled={phase.kind === 'working'}>
          {phase.kind === 'working' ? 'Delegating...' : 'Delegate my tasks'}
        </Button>
      </div>
    </form>
  );
}
