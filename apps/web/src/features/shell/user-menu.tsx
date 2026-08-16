'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@orgflow/ui';
import { LogOut, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

// Imported from the specific modules rather than through the ../auth
// barrel: that barrel also re-exports get-session, which imports
// next/headers and therefore cannot exist in a client bundle. `Session`
// is a type-only import and erases at compile time, so it carries nothing
// into the bundle either way.
import { signOut } from '../auth/sign-out';
import type { Session } from '../auth/get-session';
import { initialsOf } from './user-summary';

export interface UserMenuProps {
  session: Session;
}

export function UserMenu({ session }: UserMenuProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { user } = session;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // The name is the accessible label rather than a generic
          // "Account": a screen reader user hears whose account this is,
          // matching what a sighted user reads from the initials.
          aria-label={`Account: ${user.displayName}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground transition-colors hover:bg-secondary"
        >
          <span aria-hidden="true">{initialsOf(user.displayName)}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-64">
        {/* Not a DropdownMenuLabel: this is two lines of identity, and the
            email needs its own smaller, muted treatment plus truncation
            for an address too long for the menu. */}
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="truncate text-sm font-medium">{user.displayName}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserRound aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={isSigningOut}
          // onSelect rather than onClick: Radix fires it for Enter and
          // Space as well as a pointer, so the keyboard path is the same
          // code rather than a second one that could drift.
          onSelect={() => {
            setIsSigningOut(true);
            void signOut();
          }}
          className="text-destructive-subtle-foreground"
        >
          <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
          {isSigningOut ? 'Signing out...' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
