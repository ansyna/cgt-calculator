import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getToken } from '../api';
import { INVESTOR, loggedInAs, mockFetch, renderAt } from '../../test/helpers';
import VerifyEmailBanner from '../components/VerifyEmailBanner';
import { AcceptInvite, ForgotPassword, ResetPassword, VerifyEmail } from './account';
import Login from './Login';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Handler = Parameters<typeof mockFetch>[0];

/** Nobody logged in: the refresh cookie is missing. */
function loggedOut(handler: Handler) {
  return mockFetch((url, init) => (url.startsWith('/api/auth/refresh') ? { status: 401, body: { message: 'No session' } } : handler(url, init)));
}

const body = (init?: RequestInit) => JSON.parse(String(init?.body));

describe('Forgot password', () => {
  it('links from the login page', async () => {
    loggedOut(() => undefined);
    renderAt('/login', <Login />);
    expect((await screen.findByRole('link', { name: 'Forgot your password?' })).getAttribute('href')).toBe('/forgot-password');
  });

  it('sends a reset link and shows the generic answer', async () => {
    let sent: unknown;
    loggedOut((url, init) => {
      if (url === '/api/config') return { body: { mailEnabled: true, contactEmail: '' } };
      if (url === '/api/auth/password/forgot') {
        sent = body(init);
        return { body: { message: 'If that email has an account, a reset link is on its way.' } };
      }
      return undefined;
    });
    renderAt('/forgot-password', <ForgotPassword />);
    fireEvent.change(await screen.findByLabelText('E-Mail Address'), { target: { value: 'ivy@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByText('If that email has an account, a reset link is on its way.')).toBeTruthy();
    expect(sent).toEqual({ email: 'ivy@example.com' });
  });

  it('points to the admin when the site cannot send email', async () => {
    loggedOut((url) => (url === '/api/config' ? { body: { mailEnabled: false, contactEmail: 'help@example.com' } } : undefined));
    renderAt('/forgot-password', <ForgotPassword />);
    expect((await screen.findByRole('link', { name: 'help@example.com' })).getAttribute('href')).toBe('mailto:help@example.com');
    expect(screen.queryByRole('button', { name: 'Send reset link' })).toBeNull();
  });
});

describe('Reset password', () => {
  it('saves the new password with the token from the link', async () => {
    let sent: unknown;
    loggedOut((url, init) => {
      if (url === '/api/auth/password/reset') {
        sent = body(init);
        return { status: 204 };
      }
      return undefined;
    });
    renderAt('/reset-password?token=abc', <ResetPassword />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeTruthy();
    expect(sent).toEqual({ token: 'abc', password: 'new-password', passwordConfirmation: 'new-password' });
  });

  it('takes the token out of the address, and sends the form once', async () => {
    let calls = 0;
    let finish: (() => void) | undefined;
    loggedOut((url) => {
      if (url !== '/api/auth/password/reset') return undefined;
      calls++;
      return { status: 204 };
    });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/auth/password/reset'
        ? new Promise<Response>((resolve) => (finish = () => resolve(realFetch(input, init) as unknown as Response)))
        : realFetch(input, init)));
    renderAt('/reset-password?token=abc', <ResetPassword />);
    // kept out of the browser history
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/reset-password'));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(saving.closest('form')!);
    finish!();
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeTruthy();
    expect(calls).toBe(1);
  });

  it('shows why an expired link failed and offers a new one', async () => {
    loggedOut((url) => (url === '/api/auth/password/reset' ? { status: 400, body: { message: 'This link has expired. Ask for a new one.' } } : undefined));
    renderAt('/reset-password?token=old', <ResetPassword />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('This link has expired. Ask for a new one.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ask for a new one' }).getAttribute('href')).toBe('/forgot-password');
  });

  it('cannot submit a link without a token', () => {
    loggedOut(() => undefined);
    renderAt('/reset-password', <ResetPassword />);
    expect(screen.getByText(/This link is incomplete/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save password' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Email verification', () => {
  it('confirms the link once', async () => {
    const fetchMock = loggedOut((url) => (url === '/api/auth/email/verify' ? { status: 204 } : undefined));
    renderAt('/verify-email?token=t1', <VerifyEmail />);
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/auth/email/verify')).toHaveLength(1);
  });

  it('explains a used link', async () => {
    loggedOut((url) => (url === '/api/auth/email/verify' ? { status: 400, body: { message: 'This link was already used.' } } : undefined));
    renderAt('/verify-email?token=t1', <VerifyEmail />);
    expect((await screen.findByRole('alert')).textContent).toBe('This link was already used.');
    expect(screen.getByRole('link', { name: 'Log in to send a new link' })).toBeTruthy();
  });

  it('reminds an unconfirmed user and sends the link again', async () => {
    const fetchMock = loggedInAs({ ...INVESTOR, emailVerified: false }, (url) => (url === '/api/auth/email/resend' ? { status: 204 } : undefined));
    renderAt('/', <VerifyEmailBanner />);
    expect(await screen.findByText(/Please confirm your email address/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    expect(await screen.findByText(/A new link is on its way/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/auth/email/resend' && init?.method === 'POST')).toBe(true);
  });

  it('shows no banner once confirmed', async () => {
    const fetchMock = loggedInAs({ ...INVESTOR, emailVerified: true });
    renderAt('/', <VerifyEmailBanner />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/Please confirm your email address/)).toBeNull();
  });
});

describe('Invitations', () => {
  it('lets the invited person choose a name and password and logs them in', async () => {
    let sent: unknown;
    loggedOut((url, init) => {
      if (url === '/api/auth/invitation?token=inv') return { body: { name: 'Ann', email: 'ann@example.com' } };
      if (url === '/api/auth/invitation/accept') {
        sent = body(init);
        return { body: { token: 'fresh-token', user: { ...INVESTOR, name: 'Ann Lee', email: 'ann@example.com' } } };
      }
      return undefined;
    });
    renderAt('/accept-invite?token=inv', <AcceptInvite />);
    expect(await screen.findByText('ann@example.com')).toBeTruthy();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Ann');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ann Lee' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(sent).toEqual({ token: 'inv', name: 'Ann Lee', password: 'password123', passwordConfirmation: 'password123' });
    expect(getToken()).toBe('fresh-token');
  });

  it('explains an invitation that no longer works', async () => {
    loggedOut((url) => (url.startsWith('/api/auth/invitation') ? { status: 400, body: { message: 'This invitation has expired.' } } : undefined));
    renderAt('/accept-invite?token=old', <AcceptInvite />);
    expect((await screen.findByRole('alert')).textContent).toBe('This invitation has expired.');
    expect(screen.queryByRole('button', { name: 'Create my account' })).toBeNull();
  });
});
