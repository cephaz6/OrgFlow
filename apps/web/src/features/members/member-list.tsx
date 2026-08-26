'use client';

import type { OrganisationRole } from '@orgflow/types';
import { Alert, Button, EmptyState, StatusBadge, type StatusTone } from '@orgflow/ui';
import { CircleSlash, Pencil, UserMinus, UserRound, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { formatDate } from '../../lib/format';
import { removeMember, updateMember } from './api-client';
import { ASSIGNABLE_ROLES, type MemberEntry } from './types';

export interface MemberListProps {
  members: MemberEntry[];
  // The signed-in administrator. The API refuses self-edits outright
  // (ADR-0024), so the row hides the controls rather than offering an
  // action that is certain to fail.
  currentUserId: string;
}

const STATUS_PRESENTATION: Record<string, { tone: StatusTone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  suspended: { tone: 'warning', label: 'Suspended' },
  removed: { tone: 'neutral', label: 'Removed' },
};

function roleLabel(role: OrganisationRole): string {
  return ASSIGNABLE_ROLES.find((entry) => entry.role === role)?.label ?? 'Member';
}

export function MemberList({ members, currentUserId }: MemberListProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (members.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Nobody to show"
        description="No member matches this search. Clear it to see everyone in the organisation."
      />
    );
  }

  async function run(userId: string, action: () => Promise<unknown>) {
    setBusy(userId);
    setError(null);
    try {
      await action();
      setEditing(null);
      // The list is server-rendered, so the refreshed data comes back from
      // the API rather than being patched into local state. One source of
      // truth, and it also picks up anything the server changed that this
      // request did not ask for.
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
        <table className="w-full min-w-3xl border-collapse text-sm">
          <caption className="sr-only">
            Members of this organisation, their roles and their line manager
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">
                Member
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Roles
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Department
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Reports to
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Joined
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const presentation =
                STATUS_PRESENTATION[member.status] ?? STATUS_PRESENTATION.active!;
              const isSelf = member.userId === currentUserId;
              const isRemoved = member.status === 'removed';

              return (
                <tr key={member.userId} className="border-b border-divider last:border-b-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {member.displayName}
                        {isSelf ? (
                          <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{member.email}</span>
                    </span>
                  </th>
                  <td className="px-4 py-3">{member.roles.map(roleLabel).join(', ')}</td>
                  <td className="px-4 py-3">{member.department ?? 'Not set'}</td>
                  <td className="px-4 py-3">{member.lineManagerName ?? 'Not set'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      tone={presentation.tone}
                      icon={isRemoved ? CircleSlash : UserRound}
                      label={presentation.label}
                    />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(member.joinedAt)}</td>
                  <td className="px-4 py-3">
                    {isSelf || isRemoved ? null : (
                      <span className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={editing === member.userId}
                          onClick={() =>
                            setEditing(editing === member.userId ? null : member.userId)
                          }
                        >
                          <Pencil aria-hidden="true" className="h-4 w-4" />
                          Edit roles
                          <span className="sr-only"> for {member.displayName}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy === member.userId}
                          onClick={() => void run(member.userId, () => removeMember(member.userId))}
                        >
                          <UserMinus aria-hidden="true" className="h-4 w-4" />
                          Remove
                          <span className="sr-only"> {member.displayName}</span>
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing ? (
        <RoleEditor
          member={members.find((m) => m.userId === editing)!}
          busy={busy === editing}
          onCancel={() => setEditing(null)}
          onSave={(roles) => void run(editing, () => updateMember(editing, { roles }))}
        />
      ) : null}
    </div>
  );
}

interface RoleEditorProps {
  member: MemberEntry;
  busy: boolean;
  onCancel: () => void;
  onSave: (roles: OrganisationRole[]) => void;
}

// A fieldset of native checkboxes rather than a menu: roles are additive
// (PRD.md §12.2), so this is a multiple choice, and a native group gets
// keyboard support, grouping and labelling from the platform rather than
// from code that has to remember to add them.
function RoleEditor({ member, busy, onCancel, onSave }: RoleEditorProps) {
  const [selected, setSelected] = useState<OrganisationRole[]>(member.roles);

  function toggle(role: OrganisationRole, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, role] : current.filter((entry) => entry !== role),
    );
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        // `member` is the floor every membership carries, and it is not
        // offered as a checkbox, so it is added back here rather than being
        // silently dropped by an editor that never showed it.
        const roles = selected.includes('member') ? selected : (['member', ...selected] as const);
        onSave([...roles]);
      }}
    >
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="text-sm font-medium">Roles for {member.displayName}</legend>
        {ASSIGNABLE_ROLES.map((entry) => {
          const id = `role-${member.userId}-${entry.role}`;
          return (
            <div key={entry.role} className="flex items-start gap-3">
              <input
                id={id}
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={selected.includes(entry.role)}
                aria-describedby={`${id}-description`}
                onChange={(event) => toggle(entry.role, event.target.checked)}
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
        Everyone keeps the member role, which is what allows submitting requests and tracking them.
      </p>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save roles'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
