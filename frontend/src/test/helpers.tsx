import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import App from '../App';
import { AuthProvider } from '../platform/auth';

/** Shows the current URL so tests can assert navigation. */
export function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

export function renderAt(url: string, element: ReactNode, path = url.split('?')[0]) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <Routes>
          <Route path={path} element={<>{element}<LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

export type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;

/** The signed-in user's settings on the "server" (/api/settings), as a test's pages save them; empty for each test. */
export const savedSettings: Record<string, unknown> = {};

/** The settings API, as the server keeps them. */
function settingsApi(url: string, init?: RequestInit): { status?: number; body?: unknown } | undefined {
  if (url === '/api/settings') return { body: { ...savedSettings } };
  if (!url.startsWith('/api/settings/')) return undefined;
  const key = url.slice('/api/settings/'.length);
  const value = init?.body ? JSON.parse(String(init.body)).value : null;
  if (init?.method === 'DELETE' || value === null) delete savedSettings[key];
  else savedSettings[key] = value;
  return init?.method === 'DELETE' ? { status: 204 } : { body: value === null ? {} : { [key]: value } };
}

/** Replaces fetch with a handler returning JSON responses; returns the mock to inspect calls. */
export function mockFetch(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // like the server: without a login cookie the refresh is refused, anything else unknown isn't found
    const fallback = url.startsWith('/api/auth/refresh') ? { status: 401, body: { message: 'Unauthenticated.' } } : { status: 404, body: { message: 'Not found' } };
    const result = handler(url, init) ?? settingsApi(url, init) ?? fallback;
    const status = result.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(result.body ?? null), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const ADMIN = { id: 1, name: 'Admin', email: 'a@example.com', roles: ['admin'], permissions: ['user-create', 'role-create', 'view-investing-tools'] };
export const NEWCOMER = { id: 2, name: 'New', email: 'n@example.com', roles: [], permissions: [] };

/** A login kept in the refresh cookie: the app gets its access token from /api/auth/refresh on start. */
export function loggedInAs(user: unknown, handler: Handler = () => undefined) {
  return mockFetch((url, init) =>
    url.startsWith('/api/auth/refresh')
      ? { body: { token: 'token', user } }
      : url.startsWith('/api/auth/me') && (init?.method ?? 'GET') === 'GET'
        ? { body: user }
        : handler(url, init),
  );
}

/** Renders the whole app (router, auth, shell) at a URL. */
export function renderApp(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AuthProvider>
        <App />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

export const INVESTOR = { id: 3, name: 'Ivy Investor', email: 'ivy@example.com', roles: ['investor'], permissions: ['view-investing-tools'] };
