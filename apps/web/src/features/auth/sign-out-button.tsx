'use client';

import { Button } from '@orgflow/ui';
import { useState } from 'react';

import { signOut } from './sign-out';

// Kept for surfaces that want a plain button rather than the account menu
// (the menu in features/shell/user-menu.tsx is what the application shell
// uses); both call the same signOut, so neither can drift on where the
// session is cleared.
export function SignOutButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isSubmitting}
      onClick={() => {
        setIsSubmitting(true);
        void signOut();
      }}
    >
      {isSubmitting ? 'Signing out...' : 'Sign out'}
    </Button>
  );
}
