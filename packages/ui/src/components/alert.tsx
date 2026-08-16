import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

export type AlertVariant = 'info' | 'success' | 'destructive';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

// Each variant pairs a tinted surface with the foreground token proved
// against that exact surface in tokens.test.ts. The previous opacity-based
// tints (bg-success/10) could not be checked, because the colour that
// actually renders depends on whatever happens to sit behind them.
const VARIANT_STYLES: Record<AlertVariant, string> = {
  info: 'border-border bg-muted text-foreground',
  success: 'border-success bg-success-subtle text-success-subtle-foreground',
  destructive: 'border-destructive bg-destructive-subtle text-destructive-subtle-foreground',
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
