import { getToken } from '../api';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, NEWCOMER, renderAt } from '../../test/helpers';
import Register from './Register';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function fill(password = 'password123') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New' } });
  fireEvent.change(screen.getByLabelText('E-Mail Address'), { target: { value: 'n@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: password } });
}

describe('Register', () => {
  it('asks for at least 8 characters and shows server validation', async () => {
    mockFetch(() => ({ status: 422, body: { message: 'Invalid', errors: { email: ['The email has already been taken.'] } } }));
    renderAt('/register', <Register />);
    expect((screen.getByLabelText('Password') as HTMLInputElement).minLength).toBe(8);
    expect(screen.getByText('At least 8 characters')).toBeTruthy();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByText('The email has already been taken.')).toBeTruthy();
  });

  it('signs the new user in', async () => {
    mockFetch((url) => (url === '/api/auth/register' ? { status: 201, body: { token: 'new', user: NEWCOMER } } : undefined));
    renderAt('/register', <Register />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(getToken()).toBe('new');
    expect(localStorage.length).toBe(0);
  });
});
