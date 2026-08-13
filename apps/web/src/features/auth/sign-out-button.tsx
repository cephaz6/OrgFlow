'use client';

import { Button } from '@orgflow/ui';
import { useState } from 'react';

import { config } from '../../config/env';

export function SignOutButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSignOut() {
    setIsSubmitting(true);
    try {
      await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void onSignOut()}
      disabled={isSubmitting}
    >
      {isSubmitting ? 'Signing out...' : 'Sign out'}
    </Button>
  );
}
