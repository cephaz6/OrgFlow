'use client';

import { Alert, Button, EmptyState, Input, Label } from '@orgflow/ui';
import { Clock, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { updateRetention } from './api-client';
import type { RetentionEntry } from './types';

export interface RetentionListProps {
  definitions: RetentionEntry[];
}

export function RetentionList({ definitions }: RetentionListProps) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (definitions.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="No process definitions yet"
        description="Retention windows can be set once a process has been created."
      />
    );
  }

  function draftFor(definition: RetentionEntry): string {
    return drafts[definition.definitionId] ?? definition.retentionDays?.toString() ?? '';
  }

  async function save(definition: RetentionEntry) {
    const raw = draftFor(definition).trim();
    // Blank means "retain indefinitely" (null), matching what an empty
    // retentionDays already means everywhere else in the codebase, rather
    // than a distinct third state a person would have to learn.
    const parsed = raw === '' ? null : Number(raw);

    if (parsed !== null && (!Number.isInteger(parsed) || parsed <= 0)) {
      setError('Enter a whole number of days, or leave it blank to retain indefinitely.');
      return;
    }

    setBusy(definition.definitionId);
    setError(null);
    try {
      await updateRetention(definition.definitionId, parsed);
      setDrafts((current) => {
        const next = { ...current };
        delete next[definition.definitionId];
        return next;
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-2xl border-collapse text-sm">
          <caption className="sr-only">
            Every process definition and how long a completed case is kept before redaction
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">
                Process
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Retention (days)
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Save</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((definition) => {
              const id = `retention-${definition.definitionId}`;
              const dirty = definition.definitionId in drafts;
              return (
                <tr
                  key={definition.definitionId}
                  className="border-b border-divider last:border-b-0"
                >
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {definition.name}
                  </th>
                  <td className="px-4 py-3">
                    <Label htmlFor={id} className="sr-only">
                      Retention in days for {definition.name}
                    </Label>
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      placeholder="Indefinite"
                      className="w-32"
                      value={draftFor(definition)}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [definition.definitionId]: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {dirty ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy === definition.definitionId}
                        onClick={() => void save(definition)}
                      >
                        <Save aria-hidden="true" className="h-4 w-4" />
                        {busy === definition.definitionId ? 'Saving...' : 'Save'}
                        <span className="sr-only"> retention for {definition.name}</span>
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
