import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/helpers';

const init = vi.fn();
const captureException = vi.fn();
vi.mock('./sentry', () => ({ init, captureException }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  init.mockClear();
  captureException.mockClear();
});

const config = (dsn: string) => ({ contactEmail: '', mailEnabled: false, sentry: { dsn, environment: 'production', release: 'abc123' } });

describe('breadcrumbs', () => {
  it('keep no labels of the elements clicked, which can name people', async () => {
    const { withoutLabels } = await import('./monitoring');
    expect(withoutLabels({ category: 'ui.click', message: 'button.btn[aria-label="Delete Jane Doe"][title="Delete"]' }).message)
      .toBe('button.btn[aria-label][title]');
    // other breadcrumbs are left alone
    expect(withoutLabels({ category: 'fetch', message: '[title="x"]' }).message).toBe('[title="x"]');
  });
});

describe('error reporting', () => {
  it('stays off without a DSN', async () => {
    mockFetch((url) => (url === '/api/config' ? { body: config('') } : undefined));
    const { startMonitoring, reportError } = await import('./monitoring');
    await startMonitoring();
    reportError(new Error('x'));
    expect(init).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('starts with the server settings and reports caught errors', async () => {
    mockFetch((url) => (url === '/api/config' ? { body: config('https://key@o1.ingest.sentry.io/2') } : undefined));
    const { startMonitoring, reportError } = await import('./monitoring');
    await startMonitoring();
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ dsn: 'https://key@o1.ingest.sentry.io/2', environment: 'production', release: 'abc123', dataCollection: expect.objectContaining({ userInfo: false, cookies: false }) }));
    const error = new Error('boom');
    reportError(error, { componentStack: 'at Page' });
    expect(captureException).toHaveBeenCalledWith(error, { extra: { componentStack: 'at Page' } });
  });

  it('keeps tokens and emails out of reports', async () => {
    mockFetch((url) => (url === '/api/config' ? { body: config('https://key@o1.ingest.sentry.io/2') } : undefined));
    const { startMonitoring } = await import('./monitoring');
    await startMonitoring();
    const { beforeSend, beforeBreadcrumb } = init.mock.calls[0][0];
    const event = beforeSend({
      request: { url: 'https://screener.example/reset-password?token=s3cret', headers: { Referer: 'https://screener.example/accept-invite?token=inv1' } },
      exception: { values: [{ value: 'No account for ivy@example.com' }] },
      breadcrumbs: [{ category: 'navigation', data: { from: '/verify-email?token=v1', to: '/' } }],
    });
    expect(event.request.url).toBe('https://screener.example/reset-password?token=***');
    expect(event.request.headers.Referer).toBe('https://screener.example/accept-invite?token=***');
    expect(event.exception.values[0].value).toBe('No account for [email]');
    expect(event.breadcrumbs[0].data.from).toBe('/verify-email?token=***');
    expect(beforeBreadcrumb({ category: 'fetch', data: { url: '/api/auth/invitation?token=t&x=1' } }).data.url).toBe('/api/auth/invitation?token=***&x=1');
  });
});
