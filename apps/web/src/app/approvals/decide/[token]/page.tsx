import type { Metadata } from 'next';

import { ConfirmTaskDecision, fetchTaskDecisionPreview } from '../../../../features/approvals';
import { OrgFlowLogo } from '../../../../features/shell';
import { formatDateTime } from '../../../../lib/format';

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const preview = await fetchTaskDecisionPreview(token);
  return { title: preview ? `Approve ${preview.reference}: OrgFlow` : 'Approve request: OrgFlow' };
}

// The safe GET half of the one-click approve link (docs/decisions.md): read
// only, so an email security scanner's pre-fetch never approves anything.
// Sits outside (app), the same way /invitations/[token] does: reachable
// with no session, no sidebar or nav shell.
export default async function ConfirmTaskDecisionPage({ params }: PageProps) {
  const { token } = await params;
  const preview = await fetchTaskDecisionPreview(token);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <main id="main-content" className="flex w-full max-w-sm flex-col gap-8">
        <OrgFlowLogo decorative className="h-9 w-auto text-foreground" />

        {preview === null ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">This link is not valid</h1>
            <p className="text-sm text-muted-foreground">Open the request directly instead.</p>
          </div>
        ) : preview.status !== 'pending' ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {preview.status === 'used'
                ? 'This request has already been approved'
                : 'This link has expired'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Open {preview.reference} directly to see its current status.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Approve {preview.reference}</h1>
              <p className="text-sm text-muted-foreground">
                {preview.requesterName} raised {preview.caseTitle} ({preview.processName}), waiting
                on {preview.stepName}.
              </p>
              {preview.dueAt ? (
                <p className="text-sm text-muted-foreground">
                  Due {formatDateTime(preview.dueAt)}.
                </p>
              ) : null}
            </div>

            <ConfirmTaskDecision token={token} />
          </>
        )}
      </main>
    </div>
  );
}
