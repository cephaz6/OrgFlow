import { Inbox, LayoutDashboard, LibraryBig, ScrollText, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
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
];

// The dashboard would otherwise match every path, since every path starts
// with a slash.
export function isActiveNavItem(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
