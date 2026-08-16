import type { LucideIcon } from 'lucide-react';

import { cn } from '../lib/cn.js';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusBadgeProps {
  tone: StatusTone;
  icon: LucideIcon;
  label: string;
  className?: string;
}

const TONE_STYLES: Record<StatusTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  info: 'bg-primary-subtle text-primary-subtle-foreground border-primary',
  success: 'bg-success-subtle text-success-subtle-foreground border-success',
  warning: 'bg-warning-subtle text-warning-subtle-foreground border-warning',
  danger: 'bg-destructive-subtle text-destructive-subtle-foreground border-destructive',
};

// CLAUDE.md §3 and §5.3: status is never conveyed by colour alone. Both the
// icon and the label are required parameters rather than optional ones, so
// a colour-only badge is not a thing this component can be asked to render.
// The tone is the third signal, not the first.
export function StatusBadge({ tone, icon: Icon, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE_STYLES[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
