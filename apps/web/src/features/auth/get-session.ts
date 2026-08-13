import type { OrganisationRole } from '@orgflow/types';
import { cookies } from 'next/headers';

import { config } from '../../config/env';

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
}

export interface Session {
  user: SessionUser;
  organisationId: string | null;
  roles: OrganisationRole[];
}

// Server-only: forwards the incoming request's cookies to the API so
// GET /auth/session sees the same httpOnly session cookie the browser
// would have sent directly. Never called from a client component.
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const response = await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}/auth/session`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as Session;
}
