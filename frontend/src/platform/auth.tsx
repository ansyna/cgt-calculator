import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, endSession, onUnauthorized, refreshSession, setToken, type AuthResponse } from './api';
import type { CurrentUser } from './types';

/** Who can use the apps (any of these roles). */
export const INVESTOR_ROLES = ['admin', 'investor'];
export const ADMIN_ROLES = ['admin'];

const logoutCleanups = new Set<() => void>();

/**
 * Registers something an app keeps of the user in the browser (cached data) to forget on logout,
 * so nothing of this person stays on a shared phone.
 *
 * @returns a function that unregisters it
 */
export function onLogout(cleanup: () => void): () => void {
  logoutCleanups.add(cleanup);
  return () => logoutCleanups.delete(cleanup);
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  /** The saved login couldn't be checked: the server wasn't reachable. */
  offline: boolean;
  /** Checks the saved login again (after {@link offline}). */
  retry: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, passwordConfirmation: string) => Promise<void>;
  /** Starts the session an API call returned (e.g. accepting an invitation). */
  signIn: (response: AuthResponse) => void;
  /** Logs out; resolves to whether the server confirmed it (else the login may come back on reload). */
  logout: () => Promise<boolean>;
  /** Reloads the user (after confirming the email address). */
  reloadUser: () => Promise<void>;
  /** Gives the user a new name. */
  rename: (name: string) => Promise<void>;
  can: (permission: string) => boolean;
  hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  // the login survives reloads in the HttpOnly refresh cookie: ask for an access token first
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const forget = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const logout = useCallback(async () => {
    // nothing of this person's stays in the browser (a shared phone); what's waiting to be saved goes first
    logoutCleanups.forEach((cleanup) => cleanup());
    forget();
    return endSession();
  }, [forget]);

  const retry = useCallback(() => {
    setLoading(true);
    setOffline(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    onUnauthorized(forget);
    let cancelled = false;
    refreshSession()
      .then((session) => !cancelled && setUser(session?.user ?? null))
      .catch(() => !cancelled && setOffline(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      onUnauthorized(null);
    };
  }, [forget, attempt]);

  const signIn = useCallback((response: AuthResponse) => {
    setToken(response.token);
    setUser(response.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => signIn(await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } })),
    [signIn],
  );

  const register = useCallback(
    async (name: string, email: string, password: string, passwordConfirmation: string) =>
      signIn(await api<AuthResponse>('/auth/register', { method: 'POST', body: { name, email, password, passwordConfirmation } })),
    [signIn],
  );

  const reloadUser = useCallback(async () => {
    setUser(await api<CurrentUser>('/auth/me'));
  }, []);

  const rename = useCallback(async (name: string) => {
    setUser(await api<CurrentUser>('/auth/me', { method: 'PUT', body: { name } }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      offline,
      retry,
      login,
      register,
      signIn,
      logout,
      reloadUser,
      rename,
      can: (permission) => user?.permissions.includes(permission) ?? false,
      hasRole: (...roles) => roles.some((role) => user?.roles.includes(role)),
    }),
    [user, loading, offline, retry, login, register, signIn, logout, reloadUser, rename],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
