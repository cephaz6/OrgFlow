'use client';

import { Alert, Button, Input, Label, Textarea } from '@orgflow/ui';
import { Check, LayoutTemplate } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { saveAsTemplate } from './api-client';

export interface SaveAsTemplateProps {
  definitionId: string;
  // Pre-filled from the process itself, so the common case is opening the
  // panel and pressing the button without typing anything.
  defaultName: string;
  defaultDescription: string | undefined;
  defaultCategory: string | undefined;
  // Persists any unsaved builder changes first, so the template captures
  // what the owner is looking at rather than the last thing they saved.
  onBeforeSave: () => Promise<void>;
}

type Phase =
  | { kind: 'closed' }
  | { kind: 'open' }
  | { kind: 'saving' }
  | { kind: 'saved'; name: string }
  | { kind: 'failed'; message: string };

export function SaveAsTemplate({
  definitionId,
  defaultName,
  defaultDescription,
  defaultCategory,
  onBeforeSave,
}: SaveAsTemplateProps) {
  const idPrefix = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription ?? '');
  const [category, setCategory] = useState(defaultCategory ?? '');

  // Opening the panel unmounts the button that opened it, which would drop
  // focus to the body and lose a keyboard user's place entirely. Moving it
  // to the first field is also where a pointer user would click next.
  const isOpen = phase.kind === 'open';
  useEffect(() => {
    if (isOpen) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [isOpen]);

  async function save() {
    setPhase({ kind: 'saving' });
    try {
      // Saving the draft first is what makes "save as template" mean what
      // it looks like it means. Without it, an owner who has just edited a
      // step would silently template the previous version.
      await onBeforeSave();
      await saveAsTemplate({
        definitionId,
        name,
        description: description.trim() ? description : null,
        category: category.trim() ? category : null,
      });
      setPhase({ kind: 'saved', name });
    } catch (err) {
      setPhase({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'This could not be saved as a template.',
      });
    }
  }

  if (phase.kind === 'closed') {
    return (
      <Button type="button" variant="outline" onClick={() => setPhase({ kind: 'open' })}>
        <LayoutTemplate aria-hidden="true" className="h-4 w-4" />
        Save as template
      </Button>
    );
  }

  return (
    <div className="w-full">
      <div aria-live="polite">
        {phase.kind === 'saved' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success bg-success-subtle p-4 text-success-subtle-foreground">
            <Check aria-hidden="true" className="h-4 w-4 shrink-0" />
            <p className="text-sm">
              Saved &ldquo;{phase.name}&rdquo; as a template. Anyone who can build a process here
              can now start from it.
            </p>
            <div className="ms-auto flex gap-2">
              <Link
                href="/templates"
                className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                See it in Templates
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPhase({ kind: 'closed' })}
              >
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {phase.kind === 'saved' ? null : (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <div>
            <h2 className="text-sm font-semibold">Save as a template</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Other process owners here can start from a copy. Copies are independent, so editing
              this process later never changes theirs.
            </p>
          </div>

          {phase.kind === 'failed' ? <Alert variant="destructive">{phase.message}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-name`}>Template name</Label>
              <Input
                id={`${idPrefix}-name`}
                ref={nameRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-category`}>Category (optional)</Label>
              <Input
                id={`${idPrefix}-category`}
                value={category}
                placeholder="For example, IT or Finance"
                onChange={(event) => setCategory(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-description`}>What it is for (optional)</Label>
            <Textarea
              id={`${idPrefix}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={phase.kind === 'saving' || name.trim().length === 0}
              onClick={() => void save()}
            >
              {phase.kind === 'saving' ? 'Saving...' : 'Save as template'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={phase.kind === 'saving'}
              onClick={() => setPhase({ kind: 'closed' })}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
