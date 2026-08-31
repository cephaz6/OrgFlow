'use client';

import { Alert, Button, Input, Label } from '@orgflow/ui';
import { UsersRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createGroup } from './api-client';

// No key field: the server derives a stable slug from the name
// (allocateGroupKey, mirroring process-definitions.ts's own
// allocateDefinitionKey), the same reason organisations.ts's own create
// form does not ask for a slug either. ADR-0014 means that key can never
// change once a pinned definition might reference it, so asking for one
// up front would only invite a value nobody can revise later if it turns
// out wrong.
export function GroupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createGroup({ name, description: description.trim() || null });
      setName('');
      setDescription('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That group could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="group-name">Name</Label>
        <Input
          id="group-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="IT Support"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="group-description">Description</Label>
        <Input
          id="group-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional"
        />
      </div>

      <Button type="submit" disabled={busy} className="self-start">
        <UsersRound aria-hidden="true" className="h-4 w-4" />
        {busy ? 'Creating...' : 'Create group'}
      </Button>
    </form>
  );
}
