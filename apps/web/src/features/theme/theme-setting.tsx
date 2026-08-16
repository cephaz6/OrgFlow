'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { useTheme } from './theme-provider';
import type { Theme } from './storage-key';

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; hint: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', hint: 'Always the light palette.', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Always the dark palette.', icon: Moon },
  {
    value: 'system',
    label: 'Match device',
    hint: 'Follow your device setting, including when it changes.',
    icon: Monitor,
  },
];

// The same three states as the header's menu, laid out as a labelled radio
// group because a settings page has room to explain what each one does and
// is where somebody goes to understand the choice rather than flick it.
// Native radios, so keyboard behaviour and grouping semantics come from the
// platform rather than being rebuilt.
export function ThemeSetting() {
  const { theme, setTheme } = useTheme();

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-sm font-medium">Theme</legend>
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = theme === option.value;

        return (
          // Deliberately no transition-colors here, unlike most interactive
          // surfaces in the app. The server cannot read localStorage, so it
          // always renders "Match device" as selected and hydration
          // corrects it a frame later for anyone with an explicit choice
          // stored. That correction is unavoidable; a colour transition
          // turns it from an imperceptible snap into a visible fade of the
          // wrong option highlighting and then releasing.
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
              isSelected ? 'border-primary bg-primary-subtle' : 'border-border hover:bg-accent'
            }`}
          >
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={isSelected}
              onChange={() => setTheme(option.value)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-sm text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
