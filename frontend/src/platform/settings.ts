/**
 * What the apps keep of the user besides their records (the payslip's inputs, the theme, recent tickers, the scenario
 * open), on their account (/api/settings), never on the device: loaded once signed in, before any page opens; each
 * change saved a moment later. What an earlier version kept on the device moves to the account the first time.
 */
import { useSyncExternalStore } from 'react';
import { api } from './api';
import { onLogout } from './auth';

type Values = Record<string, unknown>;

let values: Values | null = null;
/** Changed before they were loaded (the theme on the way in): kept over what's loaded. */
let early: Values = {};
let loading: Promise<void> | null = null;
/** Counts the resets: a load that started before one (an earlier sign-in's) leaves the settings alone. */
let generation = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const notify = () => listeners.forEach((l) => l());

/** Something an earlier version kept on this device: its key there, its setting's, and how it reads. */
interface FromDevice {
  localKey: string;
  key: string;
  read: (text: string) => unknown;
}

const fromDevice: FromDevice[] = [];

/**
 * Registers what an app kept on the device before (under `localKey`): moved to the setting `key` on the account when
 * it hasn't one, then taken off the device. `read` turns the text kept into the setting's value (undefined: nothing).
 */
export function settingFromDevice(localKey: string, key: string, read: (text: string) => unknown = (text) => JSON.parse(text)) {
  fromDevice.push({ localKey, key, read });
}

/** Saves a setting on the account; `keepalive`: carrying on when the page is closed. */
function save(key: string, value: unknown, keepalive = false): Promise<unknown> {
  return api(`/settings/${key}`, { method: 'PUT', body: { value: value ?? null }, keepalive });
}

/** What the device kept, moved to the account (once, the account's own value winning), and taken off the device. */
async function moveFromDevice(into: Values) {
  for (const f of fromDevice) {
    let text: string | null = null;
    try {
      text = localStorage.getItem(f.localKey);
      localStorage.removeItem(f.localKey);
    } catch {
      // storage unavailable: nothing kept
    }
    if (text === null || f.key in into) continue;
    let value: unknown;
    try {
      value = f.read(text);
    } catch {
      value = undefined;
    }
    if (value === undefined || value === null) continue;
    into[f.key] = value;
    await save(f.key, value).catch(() => undefined);
  }
}

/** Loads the user's settings (once a session). */
export function loadSettings(): Promise<void> {
  if (values) return Promise.resolve();
  const started = generation;
  loading ??= api<Values>('/settings')
    .then(async (loaded) => {
      const next = { ...loaded };
      await moveFromDevice(next);
      if (started !== generation) return;
      values = { ...next, ...early };
      // changed before (signed out, or on the way in): saved now
      for (const [key, value] of Object.entries(early)) await save(key, value).catch(() => undefined);
      early = {};
      notify();
    })
    .catch((e) => {
      if (started === generation) loading = null;
      throw e;
    });
  return loading;
}

export const settingsLoaded = () => values !== null;

/** The settings as they are: loaded, or changed before they were. */
const current = (): Values => values ?? early;

/** A setting's value; `fallback` when it has none. */
export function setting<T>(key: string, fallback: T): T {
  return key in current() ? (current()[key] as T) : fallback;
}

/** Sets a setting (null or undefined: takes it out), saved on the account a moment after its last change. */
export function saveSetting(key: string, value: unknown, delayMs = 500) {
  const next = { ...current(), [key]: value };
  if (value === null || value === undefined) delete next[key];
  // not loaded yet (signed out): saved once they are
  if (values === null) {
    early = next;
    notify();
    return;
  }
  values = next;
  notify();
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void save(key, value).catch(() => undefined);
    }, delayMs),
  );
}

/** Saves what's waiting now (the page is being left: the requests carry on once it's closed). */
export function flushSettings() {
  for (const [key, timer] of timers) {
    clearTimeout(timer);
    void save(key, current()[key], true).catch(() => undefined);
  }
  timers.clear();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A setting's value, the page shown again when it changes; `fallback` when it has none. */
export function useSetting<T>(key: string, fallback: T): T {
  const value = useSyncExternalStore(subscribe, () => current()[key]);
  return value === undefined ? fallback : (value as T);
}

const byPrefix = new Map<string, { from: Values; found: Values }>();

/** The settings whose keys start so (an app's records kept a setting each: `pay.plan.<id>`), the same object till they change. */
export function settingsStartingWith(prefix: string): Values {
  const from = current();
  const kept = byPrefix.get(prefix);
  if (kept && kept.from === from) return kept.found;
  const found = Object.fromEntries(Object.entries(from).filter(([key]) => key.startsWith(prefix)));
  byPrefix.set(prefix, { from, found });
  return found;
}

/** The settings whose keys start so, the page shown again when they change. */
export function useSettingsStartingWith(prefix: string): Values {
  return useSyncExternalStore(subscribe, () => settingsStartingWith(prefix));
}

/** Whether the settings are loaded (the page waits for them). */
export function useSettingsLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => values !== null);
}

/** Forgets the settings (logged out; and between tests). */
export function resetSettings() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  values = null;
  early = {};
  loading = null;
  generation++;
  notify();
}

onLogout(() => {
  flushSettings();
  resetSettings();
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSettings);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSettings());
}
