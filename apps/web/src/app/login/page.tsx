import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getSession, LoginForm } from '../../features/auth';
import { OrgFlowLogo } from '../../features/shell';

export const metadata: Metadata = {
  title: 'Sign in — OrgFlow',
};

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect('/');
  }

  return (
    <div className="flex min-h-screen">
      <main id="main-content" className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-8">
          {/* Inherits text-foreground, so the one asset serves both themes
              without a second file to keep in step. Decorative here: the
              heading below already names the product. */}
          <OrgFlowLogo decorative className="h-9 w-auto text-foreground" />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to OrgFlow</h1>
            <p className="text-sm text-muted-foreground">
              Enter your work email to continue. We will send you to your organisation&apos;s
              identity provider.
            </p>
          </div>
          <LoginForm />
        </div>
      </main>

      {/* Identity, not interaction: this panel is the only large use of the
          brand colour in the product, and it carries no controls. It comes
          after the form in the DOM so that reaching the form never means
          passing through it, and it is dropped on narrow viewports rather
          than stacked above the form.

          Not aria-hidden, despite being decorative in intent: the words are
          real, sighted users read them, and hiding them would hand screen
          reader users less of the page rather than a tidier one. Which is
          also why nothing here is dimmed with an opacity utility, as that
          would put visible text below the contrast the tokens guarantee. */}
      <aside className="hidden flex-1 flex-col justify-between bg-brand p-12 text-brand-foreground lg:flex">
        {/* On the brand panel the same asset inherits text-brand-foreground
            instead, which is the whole argument for currentColor. */}
        <OrgFlowLogo className="h-8 w-auto" />
        <p className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
          Build the processes your organisation runs on, without writing code.
        </p>
        <span className="text-sm">
          Requests, approvals and audit, in one place your team already understands.
        </span>
      </aside>
    </div>
  );
}
