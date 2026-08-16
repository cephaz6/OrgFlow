import 'server-only';

import { cookies } from 'next/headers';

import { config } from '../config/env';
import { toApiError } from './api-error';

// Split from the client transport rather than sharing one module, and the
// `server-only` import is the guard that keeps it split. next/headers cannot
// exist in a browser bundle, so a client component that reaches for this
// fails at build time with a message naming this file, instead of failing
// obscurely somewhere inside the import trace.
export async function apiGet<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const response = await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    // Every one of these reads is tenant-scoped and per-user. Caching any of
    // it risks serving one organisation's data to another, which is the one
    // failure this codebase treats as unacceptable (CLAUDE.md §3).
    cache: 'no-store',
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}
