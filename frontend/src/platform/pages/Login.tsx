import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { endSession } from '../api';
import { useAuth } from '../auth';
import FieldErrors from '../components/FieldErrors';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const state = location.state as { from?: string; logoutFailed?: boolean } | null;
  const from = state?.from ?? '/';
  // the server didn't confirm the logout: the login cookie may still work on this device
  const [loginEnded, setLoginEnded] = useState(false);
  const [endingLogin, setEndingLogin] = useState(false);
  // from the address's state: the page may already be open when the logout's answer arrives
  const logoutPending = !!state?.logoutFailed && !loginEnded;

  if (user) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-card">
      <h1>Welcome back</h1>
      <p className="text-body-secondary">Sign in to analyse companies.</p>
      {logoutPending && (
        <div className="alert alert-warning" role="alert">
          Couldn't reach the server to finish logging out, so reloading this page could sign you back in.{' '}
          <button
            type="button"
            className="btn btn-sm btn-link p-0 align-baseline"
            disabled={endingLogin}
            onClick={async () => {
              setEndingLogin(true);
              setLoginEnded(await endSession());
              setEndingLogin(false);
            }}
          >
            {endingLogin ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}
      <FieldErrors error={error} />
      <form onSubmit={submit}>
        <div className="mb-3">
          <label htmlFor="email" className="form-label">
            E-Mail Address
          </label>
          <input id="email" type="email" className="form-control" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
        </div>
        <div className="mb-4">
          <label htmlFor="password" className="form-label">
            Password
          </label>
          <input id="password" type="password" className="form-control" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          <div className="form-text text-end">
            <Link to="/forgot-password">Forgot your password?</Link>
          </div>
        </div>
        <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Login'}
        </button>
      </form>
      <p className="auth-switch">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}
