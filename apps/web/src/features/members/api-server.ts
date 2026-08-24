import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';
import type { MemberEntry } from './types';

// Returns null when the API refuses with 403, so the page can render the
// "admin access required" state rather than an error screen. Narrowed on
// ApiError.status rather than the message text: the message is prose meant
// for a person and will change, the status is the contract.
//
// Any other failure still propagates. A 500 is a fault, not an answer about
// permissions, and swallowing it here would show an empty directory to an
// administrator whose organisation genuinely has members.
export async function fetchMembers(query?: string): Promise<MemberEntry[] | null> {
  const path = query ? `/members?query=${encodeURIComponent(query)}` : '/members';
  try {
    const result = await apiGet<{ members: MemberEntry[] }>(path);
    return result.members;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return null;
    }
    throw err;
  }
}
