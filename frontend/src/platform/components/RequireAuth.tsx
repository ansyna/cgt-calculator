import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { loadSettings, useSettingsLoaded } from '../settings';
import WaitingForAccess from './WaitingForAccess';

/**
 * Guards a route: requires login, and optionally one of the given roles (like Laravel's role middleware); the page
 * opens once the user's settings are loaded from their account (never from the device).
 */
export default function RequireAuth({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { user, loading, hasRole } = useAuth();
  const location = useLocation();
  const settingsLoaded = useSettingsLoaded();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (user && !settingsLoaded) loadSettings().catch(() => setFailed(true));
  }, [user, settingsLoaded, attempt]);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (failed && !settingsLoaded) {
    return (
      <div className="state-card" role="alert">
        <div>
          <div className="state-title">Your settings couldn&apos;t be loaded</div>
          <div className="state-text">Check your connection.</div>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm mt-2"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!settingsLoaded) return null;
  if (roles && !hasRole(...roles)) {
    if (user.roles.length === 0) return <WaitingForAccess />;
    return (
      <div className="state-card">
        <div>
          <div className="state-title">No access</div>
          <div className="state-text">User does not have the right roles.</div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
