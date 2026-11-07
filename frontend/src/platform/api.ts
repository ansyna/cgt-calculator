/** Thin fetch wrapper for the Spring Boot API. */

import type { AuthResponse, ErrorBody } from './types';

/** Sent with the cookie-based calls; other sites can't add it (see AuthController.CSRF_HEADER). */
const APP_HEADER = { 'X-Requested-With': 'fetch' };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

/**
 * The server couldn't be reached (no signal, or it is restarting). Not the same as being logged out: the login
 * is kept, and the call can be tried again.
 */
export class ConnectionError extends ApiError {
  constructor(message = "Can't reach the server. Check your connection and try again.") {
    super(0, message);
  }
}

/**
 * How long a call may wait for the server's answer. Without a limit a server that doesn't answer leaves the page
 * waiting for ever ("Signing in…"). Long enough for the slowest page (a company's first load).
 */
export const REQUEST_TIMEOUT_MS = 60_000;

const NO_ANSWER = "The server isn't answering. If it was idle, it may be starting up, which takes a few minutes: try again shortly.";

/** fetch, giving up after {@link REQUEST_TIMEOUT_MS}; any failure to get an answer is a {@link ConnectionError}. */
function send(input: string, init: RequestInit): Promise<Response> {
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  return fetch(input, { ...init, signal }).catch((error: unknown) => {
    throw error instanceof DOMException && error.name === 'TimeoutError' ? new ConnectionError(NO_ANSWER) : new ConnectionError();
  });
}

export type { AuthResponse };

// the short-lived access token, in memory only: page scripts can't read the long-lived refresh cookie
let accessToken: string | null = null;

export function getToken(): string | null {
  return accessToken;
}

export function setToken(token: string | null) {
  accessToken = token;
}

const responseListeners = new Set<(response: Response) => void>();

/**
 * Registers a listener for every API answer (e.g. to read a count the server sends in the headers).
 *
 * @returns a function that unregisters it
 */
export function onApiResponse(listener: (response: Response) => void): () => void {
  responseListeners.add(listener);
  return () => responseListeners.delete(listener);
}

let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

let refreshing: Promise<AuthResponse | null> | null = null;

/**
 * Exchanges the HttpOnly refresh cookie for a new access token; null when not logged in. Rejects with a
 * {@link ConnectionError} when the server can't be reached or fails, which says nothing about the login. Calls made
 * at the same time share one request (each refresh replaces the cookie).
 *
 * A slow refresh (the server waking up) is waited for at most {@link REQUEST_TIMEOUT_MS}, but never cancelled: the
 * server replaces the cookie's token when it answers, and an answer the browser dropped would leave it the old
 * token, which the server takes for a copied one.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', headers: APP_HEADER, credentials: 'same-origin' })
      .catch(() => {
        throw new ConnectionError();
      })
      .then(async (response) => {
        // only the server saying so means logged out
        if (response.status === 401 || response.status === 403) {
          accessToken = null;
          return null;
        }
        if (!response.ok) throw new ConnectionError();
        const session = (await response.json().catch(() => {
          throw new ConnectionError();
        })) as AuthResponse;
        accessToken = session.token;
        return session;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  // a retry while it is still on its way waits for the same request
  return stopWaiting(refreshing);
}

/** The promise, or a {@link ConnectionError} after {@link REQUEST_TIMEOUT_MS}; what it waits for goes on. */
function stopWaiting<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ConnectionError(NO_ANSWER)), REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ends the login on the server (revokes the refresh cookie) and forgets the access token.
 *
 * @returns whether the server confirmed it; otherwise the cookie still logs in, e.g. after a reload
 */
export async function endSession(): Promise<boolean> {
  accessToken = null;
  try {
    const response = await send('/api/auth/logout', { method: 'POST', headers: APP_HEADER, credentials: 'same-origin' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Calls the API with the access token (refreshed once if it expired).
 *
 * @param options.keepalive the request carries on when the page is closed (e.g. saving the last change on leaving)
 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string>; keepalive?: boolean } = {},
): Promise<T> {
  const query = options.params ? `?${new URLSearchParams(options.params)}` : '';
  const call = (token: string | null) => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    return send(`/api${path}${query}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
      keepalive: options.keepalive,
    });
  };

  const token = accessToken;
  let response = await call(token);
  if (response.status === 401 && token) {
    // the access token expired: get a new one from the refresh cookie and try once more (no connection: the
    // ConnectionError goes to the page, the login stays)
    const session = await refreshSession();
    if (session) response = await call(session.token);
    else unauthorizedHandler?.();
  }
  responseListeners.forEach((listener) => listener(response));

  if (response.status === 204) return undefined as T;

  const data = parseJson(
    await response.text().catch(() => {
      throw new ConnectionError(NO_ANSWER);
    }),
  );

  if (!response.ok) {
    if (response.status === 401 && token && accessToken && unauthorizedHandler) unauthorizedHandler();
    const body = (data ?? {}) as Partial<ErrorBody>;
    const message = body.message ?? (response.status === 401 ? 'Please log in.' : `Request failed (${response.status})`);
    throw new ApiError(response.status, message, body.errors ?? {});
  }
  return data as T;
}

/** The body as JSON; null when empty or not JSON (e.g. a proxy's HTML error page). */
function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
