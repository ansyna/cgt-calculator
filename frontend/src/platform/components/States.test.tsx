import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorState, LoadingState } from './States';

describe('states', () => {
  it('announce loading and errors to screen readers', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    render(<ErrorState message="Too many requests" />);
    expect(screen.getByRole('alert').textContent).toContain('Too many requests');
  });
});
