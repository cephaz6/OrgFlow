'use client';

import type { OrganisationRole } from '@orgflow/types';
import { Button } from '@orgflow/ui';
import { Menu, X } from 'lucide-react';
import { useCallback, useRef } from 'react';

import { OrgFlowMark } from './orgflow-logo';
import { SidebarNav } from './sidebar-nav';

export interface MobileNavProps {
  roles: readonly OrganisationRole[];
}

// Uses the native <dialog> with showModal() rather than a hand-rolled
// overlay. The element gives a real focus trap, Escape to dismiss, inertness
// for the rest of the page and top-layer stacking, all of which a div would
// have to reimplement and most hand-rolled drawers get wrong.
export function MobileNav({ roles }: MobileNavProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const open = useCallback(() => dialogRef.current?.showModal(), []);
  const close = useCallback(() => dialogRef.current?.close(), []);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={open} className="lg:hidden">
        <Menu aria-hidden="true" className="h-4 w-4" />
        Menu
      </Button>

      <dialog
        ref={dialogRef}
        aria-label="Navigation"
        className="m-0 h-full max-h-none w-72 max-w-[85vw] border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground backdrop:bg-background/80"
      >
        <div className="flex items-center justify-between pb-6">
          <span className="flex items-center gap-2">
            <OrgFlowMark className="h-7 w-7 text-foreground" />
            <span className="text-sm font-semibold">OrgFlow</span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            <X aria-hidden="true" className="h-4 w-4" />
            Close
          </Button>
        </div>
        <SidebarNav roles={roles} onNavigate={close} />
      </dialog>
    </>
  );
}
