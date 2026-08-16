'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { isExplicitTheme, THEME_STORAGE_KEY, type Theme } from './storage-key';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// The DOM attribute is the source of truth (theme-script.tsx already set it
// correctly before hydration), and useSyncExternalStore is the primitive
// React documents for reading a value like that: it is what avoids the
// "setState inside an effect" cascading-render pattern a plain
// useState-plus-useEffect version falls into, since nothing here needs an
// extra render pass to correct itself after mount.
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function getSnapshot(): Theme {
  const applied = document.documentElement.getAttribute('data-theme');
  return isExplicitTheme(applied) ? applied : 'system';
}

// 'system' on the server: nothing server-rendered can know the client's
// stored choice, and this has to match what theme-toggle.tsx renders on
// the client's first pass, before useSyncExternalStore swaps in the real
// snapshot, or hydration warns about a mismatch.
function getServerSnapshot(): Theme {
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    if (next === 'system') {
      // Removing the attribute, not setting it to a literal 'system': only
      // its absence makes tokens.css's @media (prefers-color-scheme) block
      // apply, since the light block's selector is `:root:not([data-theme=
      // 'dark'])`, which an attribute value of "system" would also satisfy,
      // but removing the key from storage is what makes a future visit,
      // and a future change in system preference, actually take effect
      // rather than being pinned to whatever "system" resolved to today.
      document.documentElement.removeAttribute('data-theme');
      try {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } catch {
        // Same tolerance as theme-script.tsx: a locked-down storage
        // context should not make the toggle throw, only stop persisting.
      }
    } else {
      document.documentElement.setAttribute('data-theme', next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Persistence best-effort; the attribute is already set, so this
        // session still gets the right theme even if it will not be
        // remembered next time.
      }
    }

    // The mutation above is synchronous and does not fire any DOM event
    // useSyncExternalStore could subscribe to on its own, so every known
    // consumer is told directly to re-read the attribute it just changed.
    for (const listener of listeners) {
      listener();
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider.');
  }
  return context;
}
