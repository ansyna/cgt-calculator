import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadOnce } from './lazyPage';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('a page whose files are gone after a deploy', () => {
  it('reloads once to get the new version, not again within a minute', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    expect(reloadOnce(1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    // still failing after the reload: shown as an error rather than reloading forever
    expect(reloadOnce(1_030_000)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    // a later deploy reloads again
    expect(reloadOnce(1_100_000)).toBe(true);
  });
});
