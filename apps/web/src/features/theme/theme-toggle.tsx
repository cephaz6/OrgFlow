'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@orgflow/ui';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { useTheme } from './theme-provider';
import type { Theme } from './storage-key';

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match device', icon: Monitor },
];

// A menu of three, not a two-way switch. "Match device" is a real, distinct
// state, not the absence of a choice: it means "keep following the system
// as it changes", which a sun/moon toggle alone cannot express, and which
// silently becomes unreachable the moment a user picks either side of a
// binary switch.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // The trigger shows the setting, not the resolved appearance: under
  // 'system' it stays a monitor rather than becoming a sun or moon. The
  // alternative tells the user which theme they are looking at, which they
  // can already see, while hiding whether it will follow the device
  // tomorrow, which they cannot.
  const TriggerIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Icon-only, so the accessible name has to come from here; without
          // it the button announces as just "button".
          aria-label="Theme"
          className="h-9 w-9 p-0"
        >
          <TriggerIcon aria-hidden="true" className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1">{option.label}</span>
                {/* The tick is the visual echo of aria-checked, which the
                    menuitemradio role already carries; it is never the
                    only signal that an option is selected. */}
                <DropdownMenuItemIndicator>
                  <Check aria-hidden="true" className="h-4 w-4" />
                </DropdownMenuItemIndicator>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
