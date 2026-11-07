import type { JSX } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as monitoring from '../monitoring';
import ErrorBoundary from './ErrorBoundary';

afterEach(() => vi.restoreAllMocks());

function Broken(): JSX.Element {
  throw new Error('render failed');
}

it('shows a way out instead of a blank page, and reports the crash', () => {
  const report = vi.spyOn(monitoring, 'reportError').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(screen.getByRole('alert').textContent).toContain('Something went wrong on this page');
  // what failed, to pass on
  expect(screen.getByText('render failed', { selector: 'code' })).toBeTruthy();
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'render failed' }), expect.objectContaining({ componentStack: expect.any(String) }));
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  expect(reload).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function Page({ ticker }: { ticker: string }): JSX.Element {
  if (ticker === 'BAD') throw new Error('bad data');
  return <p>{ticker} page</p>;
}

it('tries the page again for another ticker', () => {
  vi.spyOn(monitoring, 'reportError').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { rerender } = render(
    <ErrorBoundary resetKey="?ticker=BAD">
      <Page ticker="BAD" />
    </ErrorBoundary>,
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  rerender(
    <ErrorBoundary resetKey="?ticker=AAPL">
      <Page ticker="AAPL" />
    </ErrorBoundary>,
  );
  expect(screen.getByText('AAPL page')).toBeTruthy();
});

function Outdated(): JSX.Element {
  throw new TypeError('Failed to fetch dynamically imported module: https://example.com/assets/Events-abc123.js');
}

it('says when a new version is out, rather than that something went wrong', () => {
  vi.spyOn(monitoring, 'reportError').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Outdated />
    </ErrorBoundary>,
  );
  expect(screen.getByRole('alert').textContent).toContain('The app was updated');
  expect(screen.getByRole('alert').textContent).toContain('Reload to get the new version.');
  expect(screen.queryByText('What went wrong')).toBeNull();
});

