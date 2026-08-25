import type { Metadata } from 'next';

import { getSession } from '../../../features/auth';
import { AcceptInvitation, fetchInvitationPreview } from '../../../features/invitations';
import { OrgFlowLogo } from '../../../features/shell';

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const preview = await fetchInvitationPreview(token);
  return { title: preview ? `Join ${preview.organisationName}: OrgFlow` : 'Invitation: OrgFlow' };
}

const ROLE_LABEL: Record<string, string> = {
  member: 'Member',
  approver: 'Approver',
  processOwner: 'Process owner',
  admin: 'Admin',
  owner: 'Owner',
};

// The other reachable-without-a-session screen (/login is the first), so it
// sits outside (app) the same way, with its own minimal layout rather than
// the authenticated shell's sidebar and nav.
export default async function AcceptInvitationPage({ params }: PageProps) {
  const { token } = await params;
  const [preview, session] = await Promise.all([fetchInvitationPreview(token), getSession()]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <main id="main-content" className="flex w-full max-w-sm flex-col gap-8">
        <OrgFlowLogo decorative className="h-9 w-auto text-foreground" />

        {preview === null ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">This link is not valid</h1>
            <p className="text-sm text-muted-foreground">
              Ask whoever invited you to send a new one.
            </p>
          </div>
        ) : preview.status !== 'pending' ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {preview.status === 'accepted'
                ? 'This invitation has already been accepted'
                : preview.status === 'revoked'
                  ? 'This invitation has been withdrawn'
                  : 'This invitation has expired'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Ask {preview.invitedByDisplayName} for a new one if you still need to join{' '}
              {preview.organisationName}.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Join {preview.organisationName}
              </h1>
              <p className="text-sm text-muted-foreground">
                {preview.invitedByDisplayName} has invited {preview.email} as{' '}
                {preview.roles.map((role) => ROLE_LABEL[role] ?? role).join(', ')}.
              </p>
            </div>

            <AcceptInvitation
              token={token}
              signedInEmail={session?.user.email ?? null}
              invitedEmail={preview.email}
            />
          </>
        )}
      </main>
    </div>
  );
}
