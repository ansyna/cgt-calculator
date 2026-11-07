import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetSettings } from '../platform/settings';
import { savedSettings } from './helpers';

// unmount rendered components between tests (automatic only when vitest globals are enabled)
afterEach(() => {
  cleanup();
  // nothing a test kept on the device is seen by the next
  localStorage.clear();
  // the settings on the account: none for the next test, and not loaded
  resetSettings();
  for (const key of Object.keys(savedSettings)) delete savedSettings[key];
});

// jsdom has no ResizeObserver; charts (Recharts' ResponsiveContainer) need one to mount
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no PointerEvent; without it the pointerType of pointer events is lost
if (!('PointerEvent' in globalThis)) {
  globalThis.PointerEvent = class extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? '';
    }
  } as unknown as typeof PointerEvent;
}
