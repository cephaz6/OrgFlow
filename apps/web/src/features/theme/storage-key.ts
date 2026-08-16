// Shared by theme-script.tsx (a plain string baked into an inline script,
// which cannot import a module) and theme-provider.tsx (which can). Kept
// as one exported constant anyway, so the two never carry the string
// independently and drift.
export const THEME_STORAGE_KEY = 'orgflow-theme';

export type ExplicitTheme = 'light' | 'dark';
export type Theme = ExplicitTheme | 'system';

export function isExplicitTheme(value: string | null): value is ExplicitTheme {
  return value === 'light' || value === 'dark';
}
