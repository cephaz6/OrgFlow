import type { SelectHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

// A native <select>, deliberately, rather than a custom listbox. The browser
// gives keyboard interaction, type-ahead, screen reader semantics and the
// platform's own touch picker for free, and every one of those is a thing a
// hand-built combobox gets subtly wrong. globals.css sets color-scheme:
// dark, so the popup the user agent draws matches the palette.
export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive-subtle-foreground',
        className,
      )}
      {...props}
    />
  );
}
