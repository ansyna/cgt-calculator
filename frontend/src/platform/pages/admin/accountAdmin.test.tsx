import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, loggedInAs, renderAt } from '../../../test/helpers';
import Activity from './Activity';
import InviteUser from './InviteUser';
import UserShow from './UserShow';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ROLES = {
  content: [
    { id: 2, name: 'investor', permissions: [] },
    { id: 1, name: 'admin', permissions: [] },
  ],
  page: 0, size: 100, totalElements: 2, totalPages: 1,
};
const EDITOR = { ...ADMIN, permissions: [...ADMIN.permissions, 'user-edit'] };

describe('Invite user', () => {
  it('invites with the picked roles and shows the link to share', async () => {
    let sent: unknown;
    loggedInAs(ADMIN, (url, init) => {
      if (url.startsWith('/api/roles')) return { body: ROLES };
      if (url === '/api/users/invitations' && init?.method === 'POST') {
        sent = JSON.parse(String(init.body));
        return { status: 201, body: { user: { id: 9, name: 'ann', email: 'ann@example.com', roles: ['investor', 'admin'] }, path: '/accept-invite?token=xyz', url: null, emailed: false } };
      }
      return undefined;
    });
    renderAt('/users/invite', <InviteUser />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ann@example.com' } });
    fireEvent.click(await screen.findByLabelText('admin'));
    expect((screen.getByLabelText('investor') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText(/Email isn't set up/)).toBeTruthy();
    expect((screen.getByLabelText('invitation link') as HTMLInputElement).value).toBe(`${window.location.origin}/accept-invite?token=xyz`);
    expect(sent).toEqual({ email: 'ann@example.com', name: '', roles: ['investor', 'admin'] });

    fireEvent.click(screen.getByRole('button', { name: 'Invite someone else' }));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
  });

  it('shows why an invitation was refused', async () => {
    loggedInAs(ADMIN, (url, init) => {
      if (url.startsWith('/api/roles')) return { body: ROLES };
      if (init?.method === 'POST') return { status: 422, body: { message: 'Invalid', errors: { email: ['ann@example.com already has an account.'] } } };
      return undefined;
    });
    renderAt('/users/invite', <InviteUser />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ann@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('ann@example.com already has an account.')).toBeTruthy();
  });
});

describe('Password reset link', () => {
  it('creates a link for an admin to pass on and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    loggedInAs(EDITOR, (url, init) => {
      if (url === '/api/users/2/password-reset' && init?.method === 'POST') {
        return { body: { path: '/reset-password?token=r', url: 'https://screener.example/reset-password?token=r', emailed: true } };
      }
      if (url === '/api/users/2') return { body: { id: 2, name: 'Ivy Investor', email: 'ivy@example.com', roles: ['investor'] } };
      return undefined;
    });
    renderAt('/users/2', <UserShow />, '/users/:id');
    fireEvent.click(await screen.findByRole('button', { name: 'Password reset link' }));
    expect(await screen.findByText(/We emailed the password reset link to/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('https://screener.example/reset-password?token=r');
  });

  it('is not offered for an invitation that is still pending', async () => {
    loggedInAs(EDITOR, (url) => (url === '/api/users/2' ? { body: { id: 2, name: 'Ann', email: 'ann@example.com', roles: [], invitationPending: true } } : undefined));
    renderAt('/users/2', <UserShow />, '/users/:id');
    expect(await screen.findByText("Invited; hasn't accepted yet.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Password reset link' })).toBeNull();
  });
});

describe('Activity', () => {
  const ENTRIES = {
    content: [
      { id: 3, at: '2026-10-18T09:30:00Z', actor: '', action: 'login.failed', target: 'ivy@example.com', details: '', ip: '203.0.113.5' },
      { id: 2, at: '2026-10-18T09:00:00Z', actor: 'a@example.com', action: 'user.approved', target: 'pat@example.com', details: 'Roles: investor', ip: '198.51.100.1' },
      { id: 1, at: '2026-10-18T08:00:00Z', actor: 'a@example.com', action: 'something.new', target: '', details: '', ip: '' },
    ],
    page: 0, size: 25, totalElements: 30, totalPages: 2,
  };

  it('lists entries in plain words and highlights warnings', async () => {
    loggedInAs(ADMIN, (url) => (url.startsWith('/api/activity') ? { body: ENTRIES } : undefined));
    renderAt('/activity', <Activity />);
    const failed = (await screen.findByText('Failed login')).closest('tr')!;
    expect(failed.className).toBe('activity-warning');
    expect(within(failed).getByText('not logged in')).toBeTruthy();
    expect(within(failed).getByText('203.0.113.5')).toBeTruthy();
    const approved = screen.getByText('Approved sign-up').closest('tr')!;
    expect(approved.className).toBe('');
    expect(within(approved).getByText('Roles: investor')).toBeTruthy();
    expect(screen.getByText('something.new')).toBeTruthy();
  });

  it('filters by type and pages', async () => {
    const fetchMock = loggedInAs(ADMIN, (url) => (url.startsWith('/api/activity') ? { body: ENTRIES } : undefined));
    renderAt('/activity', <Activity />);
    await screen.findByText('Failed login');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'login' } });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/activity?type=login'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/activity?page=0&type=login')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/activity?type=login&page=1'));
  });

  it('says when nothing has been recorded', async () => {
    loggedInAs(ADMIN, (url) => (url.startsWith('/api/activity') ? { body: { ...ENTRIES, content: [], totalElements: 0, totalPages: 0 } } : undefined));
    renderAt('/activity', <Activity />);
    expect(await screen.findByText('Nothing recorded yet.')).toBeTruthy();
  });
});
