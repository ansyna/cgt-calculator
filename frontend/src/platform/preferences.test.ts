import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, systemTheme, useTheme } from './preferences';
import { savedSettings, loggedInAs, INVESTOR } from '../test/helpers';
import { loadSettings } from './settings';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-bs-theme');
});

function prefersDark(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: dark && query.includes('dark'), media: query }));
}

describe('theme', () => {
  it("is the system's until the user picks one, then theirs, kept on their account", async () => {
    loggedInAs(INVESTOR);
    prefersDark(true);
    expect(systemTheme()).toBe('dark');
    prefersDark(false);
    expect(systemTheme()).toBe('light');
    await loadSettings();
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('light');
    act(() => result.current[1]('dark'));
    expect(result.current[0]).toBe('dark');
    await vi.waitFor(() => expect(savedSettings.theme).toBe('dark'));
    expect(localStorage.length).toBe(0);
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });

  it('chosen before signing in: saved on the account once signed in', async () => {
    loggedInAs(INVESTOR);
    prefersDark(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]('dark'));
    expect(result.current[0]).toBe('dark');
    expect(savedSettings.theme).toBeUndefined();
    await loadSettings();
    expect(savedSettings.theme).toBe('dark');
  });

});
