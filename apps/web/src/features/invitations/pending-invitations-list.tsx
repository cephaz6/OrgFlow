'use client';

import { Alert, Button, EmptyState, StatusBadge, type StatusTone } from '@orgflow/ui';
import { Ban, Clock, MailCheck, MailX, UserPlus, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { formatDate } from '../../lib/format';
import { revokeInvitation } from './api-client';
import type { InvitationEntry } from './types';

export interface PendingInvitationsListProps {
  invitations: InvitationEntry[];
}

function statusOf(invitation: InvitationEntry): {
  tone: StatusTone;
  label: string;
  icon: LucideIcon;
} {
  if (invitation.revokedAt) {
    return { tone: 'neutral', label: 'Revoked', icon: MailX };
  }
  if (invitation.acceptedAt) {
    return { tone: 'success', label: 'Accepted', icon: MailCheck };
  }
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    return { tone: 'neutral', label: 'Expired', icon: Clock };
  }
  return { tone: 'info', label: 'Pending', icon: Clock };
}

export function PendingInvitationsList({ invitations }: PendingInvitationsListProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invitations.length === 0) {
    return (
      <EmptyState
        icon={UserPlus}
        title="No invitations yet"
        description="Invite a colleague using the form above."
      />
    );
  }

  async function revoke(invitationId: string) {
    setBusy(invitationId);
    setError(null);
    try {
      await revokeInvitation(invitationId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That invitation could not be revoked.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-2xl border-collapse text-sm">
          <caption className="sr-only">Invitations sent, and their current status</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">
                Email
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Roles
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Sent
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => {
              const status = statusOf(invitation);
              const canRevoke = status.label === 'Pending';

              return (
                <tr
                  key={invitation.invitationId}
                  className="border-b border-divider last:border-b-0"
                >
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {invitation.email}
                  </th>
                  <td className="px-4 py-3">{invitation.roles.join(', ')}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={status.tone} icon={status.icon} label={status.label} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(invitation.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canRevoke ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy === invitation.invitationId}
                        onClick={() => void revoke(invitation.invitationId)}
                      >
                        <Ban aria-hidden="true" className="h-4 w-4" />
                        Revoke
                        <span className="sr-only"> invitation to {invitation.email}</span>
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
