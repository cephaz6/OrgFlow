'use client';

import { cn } from '@orgflow/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SectionTabItem {
  href: string;
  label: string;
}

export interface SectionTabsProps {
  label: string;
  items: readonly SectionTabItem[];
}

// A horizontal row of links between sibling pages, not ARIA tabs: these are
// separate routes with their own data and their own URL, not panels of one
// page, so role="tablist"/"tab" (which implies managing panel visibility
// with JavaScript, not navigation) would be the wrong semantics. A <nav>
// with aria-current is the same pattern SidebarNav already uses, laid out
// horizontally instead of down the sidebar.
export function SectionTabs({ label, items }: SectionTabsProps) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="flex gap-1 border-b border-border">
      {items.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
