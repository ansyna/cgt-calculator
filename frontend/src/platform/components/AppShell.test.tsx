import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, INVESTOR, loggedInAs, mockFetch, NEWCOMER, renderApp, savedSettings } from '../../test/helpers';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('data-bs-theme');
});

const sidebar = () => within(screen.getByRole('navigation', { name: 'Tools' }));

describe('app shell', () => {
  it('shows administration only with user or role permissions', async () => {
    loggedInAs(INVESTOR);
    const { unmount } = renderApp('/cgt/transactions');
    await screen.findByRole('navigation', { name: 'Tools' });
    expect(sidebar().queryByText('Administration')).toBeNull();
    unmount();

    loggedInAs(ADMIN);
    renderApp('/cgt/transactions');
    await screen.findByRole('navigation', { name: 'Tools' });
    expect(sidebar().getByRole('link', { name: 'Users' }).getAttribute('href')).toBe('/users');
    expect(sidebar().getByRole('link', { name: 'Roles' }).getAttribute('href')).toBe('/roles');
  });

  it('hides the calculator from users without access, saying who to ask', async () => {
    loggedInAs(NEWCOMER, (url) => (url === '/api/config' ? { body: { contactEmail: '' } } : undefined));
    renderApp('/');
    await screen.findByText('Waiting for access');
    expect(sidebar().queryAllByRole('link')).toHaveLength(0);
  });

  it('shows the user initials and logs out', async () => {
    const fetchMock = loggedInAs(ADMIN, (url) => (url === '/api/auth/logout' ? { status: 204 } : undefined));
    renderApp('/cgt/transactions');
    await screen.findByText('Admin');
    expect(screen.getByText('A', { selector: '.avatar' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/login'));
    // the server ends the login (the refresh cookie can't be cleared from the page)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/auth/logout');
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.queryByText(/finish logging out/)).toBeNull();
  });

  it('says when the server could not end the login, and tries again', async () => {
    let serverUp = false;
    loggedInAs(ADMIN, (url) => (url === '/api/auth/logout' ? (serverUp ? { status: 204 } : { status: 503, body: {} }) : undefined));
    renderApp('/cgt/transactions');
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByText(/finish logging out, so reloading this page could sign you back in/)).toBeTruthy();
    serverUp = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/finish logging out/)).toBeNull());
  });

  it('without a connection on start, keeps the login and offers to try again', async () => {
    let online = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!online) throw new TypeError('Failed to fetch');
      const url = String(input);
      return new Response(JSON.stringify(url === '/api/auth/refresh' ? { token: 't', user: ADMIN } : {}), { status: 200 });
    }));
    renderApp('/cgt/transactions');
    expect(await screen.findByText("Can't reach the server")).toBeTruthy();
    // not sent to the login page
    expect(screen.getByTestId('location').textContent).toBe('/cgt/transactions');
    online = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('navigation', { name: 'Tools' })).toBeTruthy();
  });

  it('the closed phone menu is out of reach; Escape closes it', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
    loggedInAs(ADMIN);
    const { container } = renderApp('/cgt/transactions');
    await screen.findByRole('button', { name: 'Open menu' });
    const menu = container.querySelector('#app-menu')!;
    const open = screen.getByRole('button', { name: 'Open menu' });
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(open.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(open);
    expect(menu.hasAttribute('inert')).toBe(false);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(open);
  });

  it('opens and closes the phone menu, and closes it after navigating', async () => {
    loggedInAs(ADMIN);
    const { container } = renderApp('/cgt/transactions');
    await screen.findByRole('navigation', { name: 'Tools' });
    const shell = container.querySelector('.app-shell')!;

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(shell.className).toContain('menu-open');
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(shell.className).not.toContain('menu-open');

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(container.querySelector('.sidebar-backdrop')!);
    expect(shell.className).not.toContain('menu-open');

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(sidebar().getByRole('link', { name: 'Form 11 worksheet' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/cgt/form11'));
    expect(shell.className).not.toContain('menu-open');
  });

  it('does not flash the signed-out layout while the session is checked', async () => {
    loggedInAs(ADMIN);
    const { container } = renderApp('/cgt/transactions');
    expect(container.querySelector('.auth-layout')).toBeNull();
    await screen.findByRole('navigation', { name: 'Tools' });
    expect(container.querySelector('.auth-layout')).toBeNull();
  });

  it('switches between light and dark mode and keeps the choice on the account', async () => {
    loggedInAs(ADMIN);
    renderApp('/cgt/transactions');
    await screen.findByRole('navigation', { name: 'Tools' });
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to dark mode' }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark'));
    await waitFor(() => expect(savedSettings.theme).toBe('dark'));

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to light mode' }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light'));
    await waitFor(() => expect(savedSettings.theme).toBe('light'));
    expect(localStorage.length).toBe(0);
  });

  it('uses the plain layout with the theme toggle for signed-out pages', async () => {
    mockFetch(() => undefined);
    renderApp('/register');
    expect(await screen.findByRole('heading', { name: 'Create an account' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Tools' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });

  it('sends anonymous visitors of a tool to login and back after signing in', async () => {
    mockFetch((url) => (url === '/api/auth/login' ? { body: { token: 't', user: ADMIN } } : undefined));
    renderApp('/cgt/form11');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/login'));
    fireEvent.change(screen.getByLabelText('E-Mail Address'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/cgt/form11'));
  });
});
