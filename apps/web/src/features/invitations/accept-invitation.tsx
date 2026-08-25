'use client';

import { Alert, Button } from '@orgflow/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { acceptInvitation } from './api-client';

export interface AcceptInvitationProps {
  token: string;
  // The signed-in user's email, or null when nobody is signed in. Passed
  // from the server component rather than fetched here, since getSession()
  // reads next/headers and cannot run in a client component.
  signedInEmail: string | null;
  invitedEmail: string;
}

type Phase = { kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; message: string };

// Three states, not a single "accept" button, because the three things that
// can be true (nobody signed in, the wrong person signed in, the right
// person signed in) need different actions rather than different error
// text after the same click. Whoever holds this link is not asked to
// re-enter an email OrgFlow already knows: /login only takes them to the
// identity provider, which already knows who they are.
export function AcceptInvitation({ token, signedInEmail, invitedEmail }: AcceptInvitationProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  if (signedInEmail === null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Sign in with {invitedEmail} to accept this invitation, then return to this same link.
        </p>
        <Button asChild className="self-start">
          <a href="/login">Sign in</a>
        </Button>
      </div>
    );
  }

  if (signedInEmail.toLowerCase() !== invitedEmail.toLowerCase()) {
    return (
      <Alert variant="destructive">
        You are signed in as {signedInEmail}, but this invitation was sent to {invitedEmail}. Sign
        out and sign in again with that address to accept it.
      </Alert>
    );
  }

  async function accept() {
    setPhase({ kind: 'working' });
    try {
      await acceptInvitation(token);
      router.push('/');
      router.refresh();
    } catch (err) {
      setPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'The invitation could not be accepted.',
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
        onClick={() => void accept()}
      >
        {phase.kind === 'working' ? 'Joining...' : 'Accept invitation'}
      </Button>
    </div>
  );
}
