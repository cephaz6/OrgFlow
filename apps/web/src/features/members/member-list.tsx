'use client';

import type { OrganisationRole } from '@orgflow/types';
import { Alert, Button, EmptyState, StatusBadge, type StatusTone } from '@orgflow/ui';
import {
  Ban,
  CircleSlash,
  FileSearch,
  Pencil,
  RotateCcw,
  UserMinus,
  UserRound,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { formatDate } from '../../lib/format';
import { removeMember, updateMember } from './api-client';
import { ASSIGNABLE_ROLES, type MemberEntry } from './types';

export interface MemberListProps {
  members: MemberEntry[];
  // Every active member in the organisation, for the line manager picker:
  // deliberately independent of `members`, which is filtered to whatever
  // search or page the directory table is currently showing.
  managerOptions: MemberEntry[];
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

export function MemberList({ members, managerOptions, currentUserId }: MemberListProps) {
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
                Job title
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
                  <td className="px-4 py-3">{member.jobTitle ?? 'Not set'}</td>
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
                    <span className="flex justify-end gap-2">
                      {isSelf || isRemoved ? null : (
                        <>
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
                            Edit profile
                            <span className="sr-only"> for {member.displayName}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy === member.userId}
                            onClick={() =>
                              void run(member.userId, () =>
                                updateMember(member.userId, {
                                  status: member.status === 'suspended' ? 'active' : 'suspended',
                                }),
                              )
                            }
                          >
                            {member.status === 'suspended' ? (
                              <RotateCcw aria-hidden="true" className="h-4 w-4" />
                            ) : (
                              <Ban aria-hidden="true" className="h-4 w-4" />
                            )}
                            {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                            <span className="sr-only"> {member.displayName}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy === member.userId}
                            onClick={() =>
                              void run(member.userId, () => removeMember(member.userId))
                            }
                          >
                            <UserMinus aria-hidden="true" className="h-4 w-4" />
                            Remove
                            <span className="sr-only"> {member.displayName}</span>
                          </Button>
                        </>
                      )}
                      {/* Available even for the signed-in admin's own row
                          or a removed member: unlike editing roles or
                          removing, exporting a person's data carries no
                          self-lockout risk (ADR-0024), and a removed
                          member's compliance data still needs to be
                          reachable. */}
                      <Button type="button" variant="ghost" size="sm" asChild>
                        <Link href={`/settings/data-protection?userId=${member.userId}`}>
                          <FileSearch aria-hidden="true" className="h-4 w-4" />
                          Export data
                          <span className="sr-only"> for {member.displayName}</span>
                        </Link>
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing ? (
        <MemberEditor
          member={members.find((m) => m.userId === editing)!}
          managerOptions={managerOptions.filter((candidate) => candidate.userId !== editing)}
          busy={busy === editing}
          onCancel={() => setEditing(null)}
          onSave={(patch) => void run(editing, () => updateMember(editing, patch))}
        />
      ) : null}
    </div>
  );
}

interface MemberEditorProps {
  member: MemberEntry;
  // A member cannot be their own line manager, so the row being edited is
  // excluded from its own picker rather than left in as a choice the API
  // would have to refuse.
  managerOptions: MemberEntry[];
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: {
    roles: OrganisationRole[];
    jobTitle: string | null;
    department: string | null;
    lineManagerUserId: string | null;
  }) => void;
}

// Roles, job title, department and line manager in one form: PATCH
// /members/:userId already accepts all four in a single request, and
// nothing about them depends on each other, so there is no reason to split
// them into separate saves the way status (suspend/reactivate) and removal
// stay their own one-click actions above.
function MemberEditor({ member, managerOptions, busy, onCancel, onSave }: MemberEditorProps) {
  const [roles, setRoles] = useState<OrganisationRole[]>(member.roles);
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? '');
  const [department, setDepartment] = useState(member.department ?? '');
  const [lineManagerUserId, setLineManagerUserId] = useState(member.lineManagerUserId ?? '');

  function toggleRole(role: OrganisationRole, checked: boolean) {
    setRoles((current) =>
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
        const finalRoles = roles.includes('member') ? roles : (['member', ...roles] as const);
        onSave({
          roles: [...finalRoles],
          jobTitle: jobTitle.trim() || null,
          department: department.trim() || null,
          lineManagerUserId: lineManagerUserId || null,
        });
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
        Everyone keeps the member role, which is what allows submitting requests and tracking them.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`job-title-${member.userId}`} className="text-sm font-medium">
            Job title
          </label>
          <input
            id={`job-title-${member.userId}`}
            type="text"
            value={jobTitle}
            maxLength={200}
            onChange={(event) => setJobTitle(event.target.value)}
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`department-${member.userId}`} className="text-sm font-medium">
            Department
          </label>
          <input
            id={`department-${member.userId}`}
            type="text"
            value={department}
            maxLength={200}
            onChange={(event) => setDepartment(event.target.value)}
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor={`line-manager-${member.userId}`} className="text-sm font-medium">
            Reports to
          </label>
          <select
            id={`line-manager-${member.userId}`}
            value={lineManagerUserId}
            onChange={(event) => setLineManagerUserId(event.target.value)}
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Not set</option>
            {managerOptions.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.displayName} ({candidate.email})
              </option>
            ))}
          </select>
        </div>
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
