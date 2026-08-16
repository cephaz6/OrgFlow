import { config } from '../../config/env';

// Shared by the account menu and anything else offering to sign out, so
// the two cannot disagree about where the session is cleared or where the
// user lands afterwards.
//
// The redirect is a full navigation rather than a router push, deliberately:
// signing out has to discard every server component already rendered with
// the old session, and only a real navigation does that. It is in the
// `finally` because a failed logout request must not strand the user on a
// page their session may no longer be valid for.
export async function signOut(): Promise<void> {
  try {
    await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } finally {
    window.location.href = '/login';
  }
}
