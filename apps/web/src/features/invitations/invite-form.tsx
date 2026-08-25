'use client';

import type { OrganisationRole } from '@orgflow/types';
import { Alert, Button, Input, Label } from '@orgflow/ui';
import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createInvitation } from './api-client';
import { ASSIGNABLE_ROLES } from './types';

type Phase =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'sent'; email: string; inviteUrl: string }
  | { kind: 'failed'; message: string };

// The dummy email sender used locally and in tests never reaches a real
// inbox (ADR-0025), so the link is always shown after sending, not only
// when delivery is known to have failed: without it, nobody running this
// locally could ever reach the accept screen at all.
export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<OrganisationRole[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  function toggleRole(role: OrganisationRole, checked: boolean) {
    setRoles((current) => (checked ? [...current, role] : current.filter((r) => r !== role)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPhase({ kind: 'working' });
    try {
      const { inviteUrl } = await createInvitation({ email, roles });
      setPhase({ kind: 'sent', email, inviteUrl });
      setEmail('');
      setRoles([]);
      router.refresh();
    } catch (err) {
      setPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'The invitation could not be sent.',
      });
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {phase.kind === 'failed' ? <Alert variant="destructive">{phase.message}</Alert> : null}
      {phase.kind === 'sent' ? (
        <Alert>
          Invitation sent to {phase.email}. If it does not arrive, share this link directly:{' '}
          <span className="break-all font-mono text-xs">{phase.inviteUrl}</span>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-email">Work email</Label>
        <Input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="colleague@example.com"
        />
      </div>

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="text-sm font-medium">Roles</legend>
        {ASSIGNABLE_ROLES.map((entry) => {
          const id = `invite-role-${entry.role}`;
          return (
            <div key={entry.role} className="flex items-start gap-3">
              <input
                id={id}
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={roles.includes(entry.role)}
                aria-describedby={`${id}-description`}
                onChange={(event) => toggleRole(entry.role, event.target.checked)}
              />
              <span className="flex flex-col">
                <label htmlFor={id} className="text-sm font-medium">
                  {entry.label}
                </label>
                <span id={`${id}-description`} className="text-xs text-muted-foreground">
                  {entry.description}
                </span>
              </span>
            </div>
          );
        })}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Everyone who accepts gets the member role, whether or not it is picked above.
      </p>

      <Button type="submit" disabled={phase.kind === 'working'} className="self-start">
        <Send aria-hidden="true" className="h-4 w-4" />
        {phase.kind === 'working' ? 'Sending...' : 'Send invitation'}
      </Button>
    </form>
  );
}
