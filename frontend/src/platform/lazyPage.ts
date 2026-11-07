import { lazy, type ComponentType } from 'react';

const RELOADED_AT = 'cgt-calculator-reloaded-for-update';

/**
 * A page loaded on demand. Each deploy renames these files, so a tab opened before a deploy asks for files that
 * no longer exist: then the page reloads once to get the new version, instead of showing an error. A second
 * failure soon after (no connection, or a real problem) is shown as an error.
 */
export function lazyPage<T extends ComponentType>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (error) {
      if (reloadOnce()) {
        // keep showing the loading state until the reload replaces the page
        return new Promise<{ default: T }>(() => undefined);
      }
      throw error;
    }
  });
}

/** Reloads unless it already did in the last minute (then the new version didn't help); returns whether it did. */
export function reloadOnce(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT)) || 0;
    if (now - last < 60_000) return false;
    sessionStorage.setItem(RELOADED_AT, String(now));
  } catch {
    // no storage: reloading could loop, so show the error
    return false;
  }
  window.location.reload();
  return true;
}
