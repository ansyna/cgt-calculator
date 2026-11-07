import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, loggedInAs, renderAt } from '../../../test/helpers';
import RoleForm from './RoleForm';
import Roles from './Roles';
import UserForm from './UserForm';
import Users from './Users';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const USERS = {
  content: [
    { id: 2, name: 'Ivy Investor', email: 'ivy@example.com', roles: ['investor'] },
    { id: 1, name: 'Admin', email: 'a@example.com', roles: ['admin'] },
  ],
  page: 0, size: 5, totalElements: 7, totalPages: 2,
};
const PERMISSIONS = [
  { id: 1, name: 'role-list' },
  { id: 9, name: 'view-investing-tools' },
];
const ROLES = {
  content: [
    { id: 2, name: 'investor', permissions: [PERMISSIONS[1]] },
    { id: 1, name: 'admin', permissions: PERMISSIONS },
  ],
  page: 0, size: 5, totalElements: 2, totalPages: 1,
};

describe('Users', () => {
  it('lists users with icon actions but no delete for yourself', async () => {
    const admin = { ...ADMIN, permissions: [...ADMIN.permissions, 'user-edit', 'user-delete'] };
    loggedInAs(admin, (url) => (url.startsWith('/api/users') ? { body: USERS } : undefined));
    renderAt('/users', <Users />);
    const ivy = (await screen.findByText('Ivy Investor')).closest('tr')!;
    expect(within(ivy).getByText('investor', { selector: '.role-badge' })).toBeTruthy();
    expect(within(ivy).getByRole('link', { name: 'Edit Ivy Investor' }).getAttribute('href')).toBe('/users/2/edit');
    expect(within(ivy).getByRole('button', { name: 'Delete Ivy Investor' })).toBeTruthy();
    const me = screen.getByText('a@example.com').closest('tr')!;
    expect(within(me).queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('hides edit and delete without those permissions', async () => {
    loggedInAs(ADMIN, (url) => (url.startsWith('/api/users') ? { body: USERS } : undefined));
    renderAt('/users', <Users />);
    await screen.findByText('Ivy Investor');
    expect(screen.queryByRole('link', { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Create New User/ })).toBeTruthy();
  });

  it('deletes after confirmation and pages through users', async () => {
    const admin = { ...ADMIN, permissions: [...ADMIN.permissions, 'user-delete'] };
    const fetchMock = loggedInAs(admin, (url, init) => {
      if (url === '/api/users/2' && init?.method === 'DELETE') return { status: 204 };
      if (url.startsWith('/api/users')) return { body: USERS };
      return undefined;
    });
    renderAt('/users', <Users />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Ivy Investor' }));
    // the app's own dialog, not the browser's; cancelled, nothing is deleted
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Delete Ivy Investor?' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Ivy Investor' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('User deleted successfully')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/users?page=1'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/users?page=1')).toBe(true));
  });

  it('approves and rejects sign-ups waiting for a role', async () => {
    const admin = { ...ADMIN, permissions: [...ADMIN.permissions, 'user-edit', 'user-delete'] };
    let pending = [
      { id: 5, name: 'Pat Pending', email: 'pat@example.com', roles: [], emailVerified: false, createdAt: '2026-10-01T10:00:00Z' },
      { id: 6, name: 'Rae Rejected', email: 'rae@example.com', roles: [], emailVerified: true, createdAt: '2026-10-02T10:00:00Z' },
    ];
    const calls: string[] = [];
    loggedInAs(admin, (url, init) => {
      if (url === '/api/users/pending') return { body: pending };
      if (url === '/api/users/5/approve' && init?.method === 'POST') {
        calls.push(`approve ${String(init.body)}`);
        pending = pending.filter((u) => u.id !== 5);
        return { body: {} };
      }
      if (url === '/api/users/6' && init?.method === 'DELETE') {
        calls.push('delete 6');
        pending = [];
        return { status: 204 };
      }
      if (url.startsWith('/api/users')) return { body: USERS };
      return undefined;
    });
    renderAt('/users', <Users />);
    expect(await screen.findByRole('heading', { name: 'Waiting for approval (2)' })).toBeTruthy();
    expect(screen.getByText('email not confirmed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Approve Pat Pending' }));
    expect(await screen.findByText('Pat Pending can now use the calculator')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Waiting for approval (1)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reject Rae Rejected' }));
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: "Reject Rae Rejected's sign-up?" })).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText("Rae Rejected's sign-up was rejected")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Waiting for approval/ })).toBeNull());
    expect(calls).toEqual(['approve {"roles":["investor"]}', 'delete 6']);
  });

  it('creates a user with roles and returns to the list', async () => {
    let body: unknown;
    loggedInAs(ADMIN, (url, init) => {
      if (url.startsWith('/api/roles')) return { body: ROLES };
      if (url === '/api/users' && init?.method === 'POST') {
        body = JSON.parse(String(init.body));
        return { status: 201, body: {} };
      }
      return undefined;
    });
    renderAt('/users/create', <UserForm />, '/users/create');
    expect(await screen.findByRole('heading', { name: 'Create New User' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name:'), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText('Email:'), { target: { value: 'ann@example.com' } });
    fireEvent.change(screen.getByLabelText('Password:'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password:'), { target: { value: 'password123' } });
    const roles = (await screen.findByLabelText('Role:')) as HTMLSelectElement;
    await waitFor(() => expect(roles.options).toHaveLength(2));
    roles.options[0].selected = true;
    fireEvent.change(roles);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/users'));
    expect(body).toEqual({ name: 'Ann', email: 'ann@example.com', password: 'password123', confirmPassword: 'password123', roles: ['investor'] });
  });

  it('lists validation errors from the API', async () => {
    loggedInAs(ADMIN, (url, init) => {
      if (url.startsWith('/api/roles')) return { body: ROLES };
      if (init?.method === 'POST') return { status: 422, body: { message: 'Invalid', errors: { email: ['The email has already been taken.'] } } };
      return undefined;
    });
    renderAt('/users/create', <UserForm />, '/users/create');
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('The email has already been taken.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/users');
  });
});

describe('Roles', () => {
  it('shows permission counts and protects the admin role from deletion', async () => {
    const admin = { ...ADMIN, permissions: [...ADMIN.permissions, 'role-delete'] };
    loggedInAs(admin, (url) => (url.startsWith('/api/roles') ? { body: ROLES } : undefined));
    renderAt('/roles', <Roles />);
    const investor = (await screen.findByText('investor', { selector: '.role-badge' })).closest('tr')!;
    const count = (row: HTMLElement) => within(row).getAllByRole('cell')[2].textContent;
    expect(count(investor)).toBe('1');
    expect(within(investor).getByRole('button', { name: 'Delete investor' })).toBeTruthy();
    const adminRow = screen.getByText('admin', { selector: '.role-badge' }).closest('tr')!;
    expect(count(adminRow)).toBe('2');
    expect(within(adminRow).queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('edits a role by toggling permissions', async () => {
    let body: unknown;
    loggedInAs(ADMIN, (url, init) => {
      if (url === '/api/permissions') return { body: PERMISSIONS };
      if (url === '/api/roles/2' && init?.method === 'PUT') {
        body = JSON.parse(String(init.body));
        return { body: {} };
      }
      if (url === '/api/roles/2') return { body: ROLES.content[0] };
      return undefined;
    });
    renderAt('/roles/2/edit', <RoleForm />, '/roles/:id/edit');
    expect(await screen.findByRole('heading', { name: 'Edit Role' })).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('view-investing-tools') as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByLabelText('role-list'));
    fireEvent.click(screen.getByLabelText('view-investing-tools'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/roles'));
    expect(body).toEqual({ name: 'investor', permission: [1] });
  });
});
