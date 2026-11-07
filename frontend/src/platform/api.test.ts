import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, ConnectionError, REQUEST_TIMEOUT_MS, endSession, getToken, onUnauthorized, refreshSession, setToken } from './api';
import { mockFetch } from '../test/helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
  onUnauthorized(null);
});

describe('api', () => {
  it('sends the token, JSON body and query parameters', async () => {
    setToken('abc');
    const fetchMock = mockFetch(() => ({ body: { ok: true } }));
    await api('/users', { method: 'POST', body: { name: 'x' }, params: { page: '2' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/users?page=2');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer abc');
    expect(init?.body).toBe('{"name":"x"}');
  });

  it('raises validation errors with field messages', async () => {
    mockFetch(() => ({ status: 422, body: { message: 'Invalid', errors: { email: ['Taken'] } } }));
    const error = (await api('/users').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.errors).toEqual({ email: ['Taken'] });
  });

  it('logs out on 401 only when a token was sent', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    mockFetch(() => ({ status: 401, body: {} }));

    await api('/auth/login').catch(() => undefined);
    expect(handler).not.toHaveBeenCalled();

    setToken('expired');
    await api('/auth/me').catch(() => undefined);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('renews an expired access token from the refresh cookie and retries once', async () => {
    setToken('expired');
    const fetchMock = mockFetch((url, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (url === '/api/auth/refresh') return { body: { token: 'fresh', user: { id: 1 } } };
      return auth === 'Bearer fresh' ? { body: { ok: true } } : { status: 401, body: {} };
    });
    await expect(api('/valuation')).resolves.toEqual({ ok: true });
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, (init?.headers as Record<string, string>)]);
    expect(calls.map(([url]) => url)).toEqual(['/api/valuation', '/api/auth/refresh', '/api/valuation']);
    // the refresh carries the app's header (the cookie is sent by the browser)
    expect((calls[1][1] as Record<string, string>)['X-Requested-With']).toBe('fetch');
    expect(getToken()).toBe('fresh');
  });

  it('no signal while renewing the token is not a logout', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    setToken('expired');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/refresh') throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 401 });
    }));
    const error = await api('/valuation').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toMatch(/Can't reach the server/);
    expect(handler).not.toHaveBeenCalled();

    // nor is the server failing (e.g. restarting); only a refused refresh is
    mockFetch((url) => (url === '/api/auth/refresh' ? { status: 502, body: {} } : { status: 401, body: {} }));
    await expect(refreshSession()).rejects.toBeInstanceOf(ConnectionError);
    mockFetch(() => ({ status: 401, body: {} }));
    await expect(refreshSession()).resolves.toBeNull();
  });

  it('no signal at all is reported as such', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(api('/valuation')).rejects.toBeInstanceOf(ConnectionError);
  });

  it('a server that never answers is given up on, not waited for for ever', async () => {
    // a fetch that only ends when its signal aborts, as with a server that doesn't answer
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })));
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), 0);
      expect(ms).toBe(REQUEST_TIMEOUT_MS);
      return controller.signal;
    });
    try {
      const error = await api('/auth/login', { method: 'POST', body: {} }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConnectionError);
      expect((error as Error).message).toMatch(/isn't answering/);
      await expect(endSession()).resolves.toBe(false);
    } finally {
      timeout.mockRestore();
    }
  });

  it("a slow refresh is given up on but not cancelled: its new login cookie isn't lost", async () => {
    vi.useFakeTimers();
    try {
      let answer: (response: Response) => void = () => undefined;
      const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => (answer = resolve)));
      vi.stubGlobal('fetch', fetchMock);
      const waiting = refreshSession().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      const error = await waiting;
      expect(error).toBeInstanceOf(ConnectionError);
      expect((error as Error).message).toMatch(/isn't answering/);
      expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();

      // trying again waits for the same request, which the server answers at last
      const retry = refreshSession();
      answer(new Response(JSON.stringify({ token: 'late', user: { id: 1 } }), { status: 200 }));
      await expect(retry).resolves.toMatchObject({ token: 'late' });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(getToken()).toBe('late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls made together share one refresh', async () => {
    const fetchMock = mockFetch(() => ({ body: { token: 't', user: { id: 1 } } }));
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('logging out tells the server and forgets the token', async () => {
    setToken('t');
    const fetchMock = mockFetch(() => ({ status: 204 }));
    await expect(endSession()).resolves.toBe(true);
    expect(getToken()).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/logout');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('handles empty and non-JSON responses', async () => {
    mockFetch(() => ({ status: 204 }));
    await expect(api('/users/1', { method: 'DELETE' })).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(api('/analysis')).rejects.toThrow('Request failed (502)');
  });
});
