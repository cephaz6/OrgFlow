'use client';

import { Alert, Button, Input, Label } from '@orgflow/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createOrganisation } from './api-client';

type Phase = { kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; message: string };

// Only a name is asked for: the slug is derived server-side
// (apps/api/src/routes/organisations.ts), and branding/settings are
// PATCH /organisations/current concerns for after the organisation exists,
// not decisions a platform admin should make on its behalf up front.
export function CreateOrganisationForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPhase({ kind: 'working' });
    try {
      await createOrganisation(name);
      // ADR-0026: the response already reissued the session cookie with
      // this new organisation active, so landing on the dashboard is
      // immediate rather than a further "select an organisation" step.
      router.push('/');
      router.refresh();
    } catch (err) {
      setPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'The organisation could not be created.',
      });
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {phase.kind === 'failed' ? <Alert variant="destructive">{phase.message}</Alert> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="organisation-name">Organisation name</Label>
        <Input
          id="organisation-name"
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="DWP Digital"
        />
      </div>

      <Button type="submit" disabled={phase.kind === 'working'} className="self-start">
        {phase.kind === 'working' ? 'Creating...' : 'Create organisation'}
      </Button>
    </form>
  );
}
