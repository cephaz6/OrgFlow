import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '../lib/cn.js';

export interface PaginationProps {
  // null means that direction is unavailable (already on the first page, or
  // the API said hasMore is false): rendered disabled rather than omitted,
  // so the control's position never shifts as a list is paged through.
  prevHref: string | null;
  nextHref: string | null;
  className?: string;
}

const LINK_CLASSES =
  'inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground';
const DISABLED_CLASSES = 'pointer-events-none opacity-50';

// Plain <a> elements, not next/link: packages/ui has no dependency on
// Next.js (CLAUDE.md §3's dependency direction), and every list page this
// renders on is already a full server round-trip per click with no
// client-side navigation state to preserve.
export function Pagination({ prevHref, nextHref, className }: PaginationProps) {
  return (
    <nav aria-label="Pagination" className={cn('flex items-center gap-2', className)}>
      {prevHref ? (
        <a href={prevHref} className={LINK_CLASSES}>
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          Previous
        </a>
      ) : (
        <span aria-disabled="true" className={cn(LINK_CLASSES, DISABLED_CLASSES)}>
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          Previous
        </span>
      )}
      {nextHref ? (
        <a href={nextHref} className={LINK_CLASSES}>
          Next
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </a>
      ) : (
        <span aria-disabled="true" className={cn(LINK_CLASSES, DISABLED_CLASSES)}>
          Next
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}
