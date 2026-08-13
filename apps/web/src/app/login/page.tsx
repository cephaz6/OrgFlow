import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@orgflow/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getSession, LoginForm } from '../../features/auth';

export const metadata: Metadata = {
  title: 'Sign in — OrgFlow',
};

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect('/');
  }

  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to OrgFlow</CardTitle>
          <CardDescription>Enter your work email to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
