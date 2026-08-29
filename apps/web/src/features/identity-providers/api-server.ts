import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { IdentityProviderEntry } from './types';

// Returns null on a 403, same reasoning as features/members' fetchMembers:
// lets the page render an "admin access required" state instead of an error
// screen, while any other failure (a genuine 500) still propagates.
export async function fetchIdentityProviders(): Promise<IdentityProviderEntry[] | null> {
  try {
    const { providers } = await apiGet<{ providers: IdentityProviderEntry[] }>(
      '/identity-providers',
    );
    return providers;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return null;
    }
    throw err;
  }
}
