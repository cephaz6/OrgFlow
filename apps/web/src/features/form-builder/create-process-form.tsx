'use client';

import { Alert, Button, Card, CardContent, Input, Label } from '@orgflow/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createDefinition } from './api-client';

type Status = { kind: 'idle' } | { kind: 'creating' } | { kind: 'error'; message: string };

export function CreateProcessForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [referencePrefix, setReferencePrefix] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus({ kind: 'creating' });
    try {
      const result = await createDefinition({
        name,
        referencePrefix: referencePrefix.toUpperCase(),
        ...(description ? { description } : {}),
        ...(category ? { category } : {}),
      });
      router.push(`/processes/${result.definition.definitionId}`);
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'The process could not be created.',
      });
    }
  }

  return (
    <Card className="max-w-xl">
      <CardContent className="p-6">
        <form className="flex flex-col gap-5" onSubmit={(event) => void onSubmit(event)} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="process-name">Process name</Label>
            <Input
              id="process-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="process-reference-prefix">Reference prefix</Label>
            <p className="text-sm text-muted-foreground">
              Two to ten letters, e.g. EXP. Appears on every request this process creates, such as
              EXP-000123.
            </p>
            <Input
              id="process-reference-prefix"
              required
              value={referencePrefix}
              maxLength={10}
              onChange={(event) => setReferencePrefix(event.target.value.replace(/[^a-zA-Z]/g, ''))}
              className="max-w-32 uppercase"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="process-category">Category (optional)</Label>
            <Input
              id="process-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="process-description">Description (optional)</Label>
            <Input
              id="process-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {status.kind === 'error' ? <Alert variant="destructive">{status.message}</Alert> : null}

          <Button type="submit" disabled={status.kind === 'creating' || referencePrefix.length < 2}>
            {status.kind === 'creating' ? 'Creating...' : 'Create and open the builder'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
