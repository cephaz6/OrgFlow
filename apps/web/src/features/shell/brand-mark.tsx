import { cn } from '@orgflow/ui';

export interface BrandMarkProps {
  className?: string;
}

// The one place the brand colour appears in the application shell. It marks
// identity, never interaction: OrgFlow's blue is what a user clicks, and
// keeping the two hues apart is the reason --brand exists separately from
// --primary at all.
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground',
        className,
      )}
    >
      {/* Decorative: the product name sits beside it as real text, so
          announcing the mark as well would read the name twice. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        className="h-4 w-4"
      >
        <path d="M5 6h14" />
        <path d="M5 12h9" />
        <path d="M5 18h5" />
      </svg>
    </span>
  );
}
