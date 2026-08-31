import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  // Absent on the current page, the last item: it is announced as the
  // page you are on, not a place to navigate to.
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

// Plain <a> elements, not next/link, for the same reason Pagination's own
// are: packages/ui has no dependency on Next.js (CLAUDE.md §3's dependency
// direction).
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={item.href ?? item.label} className="flex items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              ) : null}
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  {item.label}
                </a>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className="text-foreground">
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
