'use client';

import { Alert, Button, EmptyState, StatusBadge } from '@orgflow/ui';
import { ArrowLeftRight, Trash2, UserRoundCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { cancelDelegation } from './api-client';
import type { DelegationEntry } from './types';

function formatRange(startsAt: string, endsAt: string): string {
  const format = (value: string) => new Date(value).toISOString().slice(0, 10);
  return `${format(startsAt)} to ${format(endsAt)}`;
}

function isActive(entry: DelegationEntry): boolean {
  const now = Date.now();
  return new Date(entry.startsAt).getTime() <= now && now <= new Date(entry.endsAt).getTime();
}

export interface DelegationListProps {
  delegations: DelegationEntry[];
}

export function DelegationList({ delegations }: DelegationListProps) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (delegations.length === 0) {
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="No delegations"
        description="Delegate your tasks to a colleague while you are away, or see who has delegated to you."
      />
    );
  }

  function cancel(delegationId: string) {
    setError(null);
    setCancellingId(delegationId);
    void cancelDelegation(delegationId)
      .then(() => {
        router.refresh();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'The delegation could not be cancelled.');
      })
      .finally(() => setCancellingId(null));
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <ul className="flex flex-col gap-2">
        {delegations.map((entry) => (
          <li
            key={entry.delegationId}
            className="flex flex-col gap-2 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {entry.direction === 'outgoing'
                    ? `Delegated to ${entry.counterpartName}`
                    : `Delegated from ${entry.counterpartName}`}
                </span>
                {isActive(entry) ? (
                  <StatusBadge tone="success" icon={UserRoundCheck} label="Active" />
                ) : null}
              </div>
              <span className="text-sm text-muted-foreground">
                {formatRange(entry.startsAt, entry.endsAt)}
                {entry.reason ? `: ${entry.reason}` : ''}
              </span>
            </div>
            {entry.direction === 'outgoing' ? (
              <Button
                type="button"
                variant="outline"
                disabled={cancellingId === entry.delegationId}
                onClick={() => cancel(entry.delegationId)}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                {cancellingId === entry.delegationId ? 'Cancelling...' : 'Cancel'}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
