import { Button } from '@orgflow/ui';
import type { Metadata } from 'next';

import { getSession } from '../../../features/auth';
import { CreateOrganisationForm } from '../../../features/organisations';
import { OrgFlowLogo } from '../../../features/shell';

export const metadata: Metadata = {
  title: 'New organisation: OrgFlow',
};

// Outside (app), like /login and /invitations/:token: reachable before an
// organisation exists to be authenticated into, since this is what creates
// the first one for a platform admin who does not yet have any.
export default async function NewOrganisationPage() {
  const session = await getSession();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <main id="main-content" className="flex w-full max-w-sm flex-col gap-8">
        <OrgFlowLogo decorative className="h-9 w-auto text-foreground" />

        {session === null ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Sign in first</h1>
              <p className="text-sm text-muted-foreground">
                Creating an organisation needs platform admin access, which OrgFlow can only check
                once you are signed in.
              </p>
            </div>
            <Button asChild className="self-start">
              <a href="/login">Sign in</a>
            </Button>
          </div>
        ) : !session.user.isPlatformAdmin ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Platform admin access required
            </h1>
            <p className="text-sm text-muted-foreground">
              Creating an organisation is limited to platform admins. Ask whoever operates OrgFlow
              for your institution to create it, or to invite you into an existing one.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Create an organisation</h1>
              <p className="text-sm text-muted-foreground">
                You will become its first owner, and can invite the rest of its members afterward.
              </p>
            </div>
            <CreateOrganisationForm />
          </>
        )}
      </main>
    </div>
  );
}
