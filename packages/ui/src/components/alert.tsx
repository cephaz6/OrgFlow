import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

export type AlertVariant = 'info' | 'success' | 'destructive';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

const VARIANT_STYLES: Record<AlertVariant, string> = {
  info: 'border-border bg-background text-foreground',
  success: 'border-success/40 bg-success/10 text-success',
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const VARIANT_ICONS: Record<AlertVariant, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  destructive: AlertCircle,
};

// Status is never colour-only (CLAUDE.md §5.3): every variant pairs its
// colour with a distinct icon, so the message reads correctly even without
// colour perception.
export function Alert({ className, variant = 'info', role, children, ...props }: AlertProps) {
  const Icon = VARIANT_ICONS[variant];

  return (
    <div
      role={role ?? (variant === 'destructive' ? 'alert' : 'status')}
      className={cn(
        'flex items-start gap-3 rounded-md border p-4 text-sm',
        VARIANT_STYLES[variant],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
