import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSession } from '../../features/auth';
import { AppShell } from '../../features/shell';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  return <AppShell session={session}>{children}</AppShell>;
}
