'use client';

import type { OrganisationRole } from '@orgflow/types';
import { cn } from '@orgflow/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isActiveNavItem, visibleNavGroups } from './nav';

export interface SidebarNavProps {
  roles: readonly OrganisationRole[];
  // Set when the nav is rendered inside the mobile dialog, so that
  // following a link closes the dialog rather than leaving it covering the
  // page it just navigated to.
  onNavigate?: () => void;
}

export function SidebarNav({ roles, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const groups = visibleNavGroups(roles);

  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {/* The group label names the list for a screen reader as well as
              captioning it visually, so the two are the same element
              rather than a heading plus a redundant aria-label. */}
          <h2
            id={`nav-group-${group.label.toLowerCase()}`}
            className="px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            {group.label}
          </h2>
          <ul aria-labelledby={`nav-group-${group.label.toLowerCase()}`} className="flex flex-col">
            {group.items.map((item) => {
              const isActive = isActiveNavItem(item.href, pathname);
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    // Wrapped rather than passed straight through: under
                    // exactOptionalPropertyTypes an absent handler is not
                    // the same as an undefined one.
                    onClick={() => onNavigate?.()}
                    // aria-current is what actually communicates the active
                    // item. The background tint is the visual echo of it,
                    // never the only signal (CLAUDE.md §3).
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
