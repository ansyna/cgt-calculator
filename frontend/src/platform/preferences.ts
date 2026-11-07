/**
 * The theme: the user's, kept on their account with their other settings, once they're signed in; the system's
 * before (nothing is kept on the device).
 */
import { saveSetting, useSetting } from './settings';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'theme';

const themeOf = (value: unknown): Theme | undefined => (value === 'light' || value === 'dark' ? value : undefined);

/** The system's light or dark. */
export function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-bs-theme', theme);
}

/** The theme shown, and choosing one (kept on the account). */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = themeOf(useSetting<unknown>(THEME_KEY, null)) ?? systemTheme();
  // a click, not typing: saved at once
  return [theme, (next) => saveSetting(THEME_KEY, next, 0)];
}
