import {
  ChartNoAxesCombined,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LibraryBig,
  ScrollText,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { OrganisationRole } from '@orgflow/types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Absent means everybody in the organisation sees the item, which is the
  // existing behaviour every item before this one relies on. Present means
  // the item only appears for a session holding at least one of these
  // roles, so a member without process-owning access is not sent to a page
  // that would only 404 or empty-list on them.
  requiresAnyRole?: OrganisationRole[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Only routes that exist. A navigation item pointing at a page that is not
// built yet is worse than no item: it reads as a broken product rather than
// an unfinished one.
//
// Grouped rather than flat because PRD.md §13.1 already names the sections
// that follow (processes, templates, reports, admin, settings), and adding
// a second group later should not mean restructuring the first.
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/approvals', label: 'Approvals', icon: Inbox },
      { href: '/cases', label: 'My requests', icon: ScrollText },
      { href: '/catalogue', label: 'Catalogue', icon: LibraryBig },
    ],
  },
  {
    label: 'Manage',
    items: [
      {
        href: '/processes',
        label: 'Processes',
        icon: Wrench,
        requiresAnyRole: ['processOwner', 'admin', 'owner'],
      },
      {
        href: '/reports',
        label: 'Reports',
        icon: ChartNoAxesCombined,
        requiresAnyRole: ['processOwner', 'admin', 'owner'],
      },
      {
        href: '/settings/members',
        label: 'Members',
        icon: Users,
        // PRD.md §12.2 gives "manage members" to admin and above, so a
        // process owner does not see this even though they see the two
        // items above it.
        requiresAnyRole: ['admin', 'owner'],
      },
      {
        href: '/settings/identity-providers',
        label: 'Identity providers',
        icon: KeyRound,
        // Same gate as Members: configuring who a session can authenticate
        // as is at least as sensitive as managing an existing one.
        requiresAnyRole: ['admin', 'owner'],
      },
    ],
  },
];

// Filters both the groups and, within a group, the items, so a group whose
// only item is role-gated disappears entirely rather than rendering an
// empty heading.
export function visibleNavGroups(roles: readonly OrganisationRole[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.requiresAnyRole || item.requiresAnyRole.some((role) => roles.includes(role)),
    ),
  })).filter((group) => group.items.length > 0);
}

// The dashboard would otherwise match every path, since every path starts
// with a slash.
export function isActiveNavItem(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
