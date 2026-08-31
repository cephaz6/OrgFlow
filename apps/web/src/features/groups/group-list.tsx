'use client';

import { Alert, Button, EmptyState, Input, Label } from '@orgflow/ui';
import { Pencil, Trash2, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteGroup, updateGroup } from './api-client';
import type { Group } from './types';

export interface GroupListProps {
  groups: Group[];
}

export function GroupList({ groups }: GroupListProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title="No groups yet"
        description="Create one using the form above. A group is a pool a workflow step can assign a task to."
      />
    );
  }

  async function run(groupId: string, action: () => Promise<unknown>) {
    setBusy(groupId);
    setError(null);
    try {
      await action();
      setEditing(null);
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
          <caption className="sr-only">Groups configured for this organisation</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">
                Group
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Description
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.groupId} className="border-b border-divider last:border-b-0">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <span className="flex flex-col">
                    <span className="font-medium">{group.name}</span>
                    <span className="text-xs text-muted-foreground">{group.key}</span>
                  </span>
                </th>
                <td className="px-4 py-3">{group.description ?? 'Not set'}</td>
                <td className="px-4 py-3">
                  <span className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" asChild>
                      <Link href={`/settings/groups/${group.groupId}`}>
                        <UsersRound aria-hidden="true" className="h-4 w-4" />
                        Members
                        <span className="sr-only"> of {group.name}</span>
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={editing === group.groupId}
                      onClick={() => setEditing(editing === group.groupId ? null : group.groupId)}
                    >
                      <Pencil aria-hidden="true" className="h-4 w-4" />
                      Edit
                      <span className="sr-only"> {group.name}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy === group.groupId}
                      onClick={() => void run(group.groupId, () => deleteGroup(group.groupId))}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                      Delete
                      <span className="sr-only"> {group.name}</span>
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <GroupEditor
          group={groups.find((entry) => entry.groupId === editing)!}
          busy={busy === editing}
          onCancel={() => setEditing(null)}
          onSave={(input) => void run(editing, () => updateGroup(editing, input))}
        />
      ) : null}
    </div>
  );
}

interface GroupEditorProps {
  group: Group;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { name: string; description: string | null }) => void;
}

// Name and description only, never the key: ADR-0014's stable identifier
// a pinned definition document resolves against, so this editor does not
// offer it as something to change.
function GroupEditor({ group, busy, onCancel, onSave }: GroupEditorProps) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ name, description: description.trim() || null });
      }}
    >
      <p className="text-sm font-medium">Editing {group.name}</p>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`edit-name-${group.groupId}`}>Name</Label>
        <Input
          id={`edit-name-${group.groupId}`}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`edit-description-${group.groupId}`}>Description</Label>
        <Input
          id={`edit-description-${group.groupId}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save changes'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
