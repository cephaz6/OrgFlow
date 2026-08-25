import 'server-only';

import type { OrganisationRole } from '@orgflow/types';
import { cookies } from 'next/headers';

import { config } from '../../config/env';

// The `server-only` import is a guard, not a runtime dependency: next/headers
// cannot exist in a browser bundle, and without this a client component that
// reaches for this module (directly or through the feature barrel, which also
// re-exports client-safe things like signOut) fails deep inside an import
// trace instead of naming this file. Same reasoning as lib/api-server.ts.

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
  // ADR-0026: global, not organisation-scoped. Gates /organisations/new.
  isPlatformAdmin: boolean;
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
