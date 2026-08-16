import type { AnchorHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

export type SkipLinkProps = AnchorHTMLAttributes<HTMLAnchorElement>;

// Visually hidden until focused, per WCAG 2.4.1 (Bypass Blocks). Must be the
// first focusable element on the page; the target id it points at is the
// consuming layout's responsibility.
export function SkipLink({
  className,
  children = 'Skip to main content',
  ...props
}: SkipLinkProps) {
  return (
    <a
      className={cn(
        'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
