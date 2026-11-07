import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INVESTOR, loggedInAs, savedSettings } from '../test/helpers';
import { flushSettings, loadSettings, resetSettings, saveSetting, setting, settingFromDevice, settingsLoaded, useSetting } from './settings';

settingFromDevice('test-kept-before', 'test.moved');
settingFromDevice('test-kept-text', 'test.text', (text) => text);

describe("the user's settings, on their account", () => {
  it("leave alone what's set after a reset when an earlier sign-in's load finishes late", async () => {
    savedSettings['cgt.paid.2025'] = 'old';
    const server = loggedInAs(INVESTOR);
    // the first load's answer held back until the rest is done
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/settings' && first) {
        first = false;
        await held;
      }
      return server(input, init);
    });
    const earlier = loadSettings();
    // signed out (or the next test) before it finished, then signed in again and changed
    resetSettings();
    await loadSettings();
    saveSetting('cgt.paid.2025', '339,90');
    release();
    await earlier;
    expect(setting('cgt.paid.2025', '')).toBe('339,90');
  });

  it('are loaded once signed in, and saved a moment after a change', async () => {
    savedSettings['pay.year'] = 2027;
    const calls = loggedInAs(INVESTOR);
    expect(settingsLoaded()).toBe(false);
    expect(setting('pay.year', 2026)).toBe(2026);
    await loadSettings();
    expect(settingsLoaded()).toBe(true);
    expect(setting('pay.year', 2026)).toBe(2027);
    // loaded once a session
    await loadSettings();
    expect(calls.mock.calls.filter(([url]) => url === '/api/settings')).toHaveLength(1);

    const { result } = renderHook(() => useSetting<string[]>('cgt.tickers', []));
    expect(result.current).toEqual([]);
    act(() => saveSetting('cgt.tickers', ['GLOBX']));
    expect(result.current).toEqual(['GLOBX']);
    act(() => saveSetting('cgt.tickers', ['AAPL', 'GLOBX']));
    expect(savedSettings['cgt.tickers']).toBeUndefined();
    // one save for the two changes, a moment later
    await vi.waitFor(() => expect(savedSettings['cgt.tickers']).toEqual(['AAPL', 'GLOBX']));
    expect(calls.mock.calls.filter(([url]) => url === '/api/settings/cgt.tickers')).toHaveLength(1);
    // taken out
    act(() => saveSetting('pay.year', null));
    flushSettings();
    await vi.waitFor(() => expect('pay.year' in savedSettings).toBe(false));
  });

  it("move what an earlier version kept on the device, the account's own winning, and leave nothing on the device", async () => {
    savedSettings['test.text'] = 'on the account';
    localStorage.setItem('test-kept-before', JSON.stringify({ a: 1 }));
    localStorage.setItem('test-kept-text', 'on the device');
    loggedInAs(INVESTOR);
    await loadSettings();
    expect(setting('test.moved', null)).toEqual({ a: 1 });
    expect(savedSettings['test.moved']).toEqual({ a: 1 });
    expect(setting('test.text', null)).toBe('on the account');
    expect(localStorage.length).toBe(0);
  });

  it('are forgotten when reset (logged out), loaded again from the account', async () => {
    loggedInAs(INVESTOR);
    await loadSettings();
    act(() => saveSetting('theme', 'dark'));
    flushSettings();
    await vi.waitFor(() => expect(savedSettings.theme).toBe('dark'));
    resetSettings();
    expect(setting('theme', 'light')).toBe('light');
    await loadSettings();
    expect(setting('theme', 'light')).toBe('dark');
  });
});
