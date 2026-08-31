'use client';

import { Alert, Button, EmptyState } from '@orgflow/ui';
import { UserMinus, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { addGroupMember, removeGroupMember } from './api-client';
import type { GroupMember } from './types';

export interface GroupMembersProps {
  groupId: string;
  members: GroupMember[];
  // Active organisation members not already in this group, for the add
  // picker: independent of `members`, mirroring the member profile
  // editor's own line-manager picker (features/members/member-list.tsx).
  candidateMembers: GroupMember[];
}

export function GroupMembers({ groupId, members, candidateMembers }: GroupMembersProps) {
  const router = useRouter();
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nobody in this group yet"
          description="Add a member using the picker below."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-lg border border-border">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="flex flex-col">
                <span className="text-sm font-medium">{member.displayName}</span>
                <span className="text-xs text-muted-foreground">{member.email}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => removeGroupMember(groupId, member.userId))}
              >
                <UserMinus aria-hidden="true" className="h-4 w-4" />
                Remove
                <span className="sr-only"> {member.displayName}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {candidateMembers.length > 0 ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selected) {
              return;
            }
            void run(() => addGroupMember(groupId, selected)).then(() => setSelected(''));
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-member" className="text-sm font-medium">
              Add a member
            </label>
            <select
              id="add-member"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="h-10 min-w-64 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Choose someone...</option>
              {candidateMembers.map((candidate) => (
                <option key={candidate.userId} value={candidate.userId}>
                  {candidate.displayName} ({candidate.email})
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={busy || !selected}>
            <UserPlus aria-hidden="true" className="h-4 w-4" />
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}
