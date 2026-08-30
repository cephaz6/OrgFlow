'use client';

import { Alert, Button } from '@orgflow/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { confirmTaskDecisionToken } from './api-client';

export interface ConfirmTaskDecisionProps {
  token: string;
}

type Phase = { kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; message: string };

// No sign-in-email-matching logic, unlike AcceptInvitation: the token
// itself is the entire authorization here, so there is nothing to compare
// a signed-in identity against. The GET this page renders from is already
// the safe preview; this component exists only to turn an explicit click
// into the one and only POST that actually approves.
export function ConfirmTaskDecision({ token }: ConfirmTaskDecisionProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function confirm() {
    setPhase({ kind: 'working' });
    try {
      await confirmTaskDecisionToken(token);
      router.push('/');
      router.refresh();
    } catch (err) {
      setPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'This request could not be approved.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {phase.kind === 'failed' ? <Alert variant="destructive">{phase.message}</Alert> : null}
      <Button
        type="button"
        disabled={phase.kind === 'working'}
        className="self-start"
        onClick={() => void confirm()}
      >
        {phase.kind === 'working' ? 'Approving...' : 'Confirm approve'}
      </Button>
    </div>
  );
}
