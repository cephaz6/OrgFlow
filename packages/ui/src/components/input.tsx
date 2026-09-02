import type { InputHTMLAttributes, Ref } from 'react';

import { cn } from '../lib/cn.js';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  // React 19 hands `ref` to a function component as an ordinary prop, so
  // this needs no forwardRef wrapper. Declared explicitly because a caller
  // that reveals an input has to be able to move focus into it: a panel
  // that opens without doing so strands anyone using a keyboard.
  ref?: Ref<HTMLInputElement>;
};

export function Input({ className, type, ref, ...props }: InputProps) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive-subtle-foreground',
        className,
      )}
      {...props}
    />
  );
}
