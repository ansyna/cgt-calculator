import { CheckCircle2 } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api, type AuthResponse } from '../api';
import { useAuth } from '../auth';
import FieldErrors from '../components/FieldErrors';
import type { Schemas } from '../types';

/** Password fields with matching hints, shared by reset and invitation. */
function NewPassword({ password, confirmation, onChange }: { password: string; confirmation: string; onChange: (password: string, confirmation: string) => void }) {
  return (
    <>
      <div className="mb-3">
        <label htmlFor="password" className="form-label">
          New password
        </label>
        <input
          id="password"
          type="password"
          className="form-control"
          value={password}
          onChange={(e) => onChange(e.target.value, confirmation)}
          minLength={8}
          required
          autoComplete="new-password"
        />
        <div className="form-text">At least 8 characters</div>
      </div>
      <div className="mb-4">
        <label htmlFor="password-confirmation" className="form-label">
          Confirm password
        </label>
        <input
          id="password-confirmation"
          type="password"
          className="form-control"
          value={confirmation}
          onChange={(e) => onChange(password, e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
    </>
  );
}

function Done({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-card auth-done" role="status">
      <CheckCircle2 size={32} aria-hidden />
      <h1>{title}</h1>
      {children}
    </div>
  );
}

/** "Forgot your password?": emails a reset link (or says to ask the admin when email isn't set up). */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [config, setConfig] = useState<{ mailEnabled: boolean; contactEmail: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<Schemas['ClientConfig']>('/config').then(setConfig).catch(() => setConfig({ mailEnabled: true, contactEmail: '' }));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      setSent((await api<Schemas['MessageResponse']>('/auth/password/forgot', { method: 'POST', body: { email } })).message);
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <Done title="Check your email">
        <p>{sent}</p>
        <p className="text-body-secondary">The link works once, for an hour. Check the spam folder if nothing arrives.</p>
        <Link to="/login">Back to login</Link>
      </Done>
    );
  }

  return (
    <div className="auth-card">
      <h1>Forgot your password?</h1>
      {config && !config.mailEnabled ? (
        <>
          <p className="text-body-secondary">
            This site can't send emails yet, so the admin has to give you a reset link
            {config.contactEmail ? (
              <>
                : write to <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>.
              </>
            ) : (
              '.'
            )}
          </p>
          <Link to="/login">Back to login</Link>
        </>
      ) : (
        <>
          <p className="text-body-secondary">Enter your email and we'll send you a link to choose a new password.</p>
          <FieldErrors error={error} />
          <form onSubmit={submit}>
            <div className="mb-4">
              <label htmlFor="email" className="form-label">
                E-Mail Address
              </label>
              <input id="email" type="email" className="form-control" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
            </div>
            <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <p className="auth-switch">
            Remembered it? <Link to="/login">Log in</Link>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The link's one-time token. It is then taken out of the address, so it doesn't stay in the browser history
 * (or reach anyone looking over the history on a shared device).
 */
function useLinkToken(): string {
  const [searchParams, setSearchParams] = useSearchParams();
  const [token] = useState(() => searchParams.get('token') ?? '');
  useEffect(() => {
    if (!searchParams.has('token')) return;
    setSearchParams(
      (params) => {
        params.delete('token');
        return params;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);
  return token;
}

/** The page the reset link opens. */
export function ResetPassword() {
  const token = useLinkToken();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // the link works once: a second tap would only report it as used
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password, passwordConfirmation: confirmation } });
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Done title="Password changed">
        <p>You're logged out everywhere else. Log in with your new password.</p>
        <Link className="btn btn-primary" to="/login">
          Log in
        </Link>
      </Done>
    );
  }
  return (
    <div className="auth-card">
      <h1>Choose a new password</h1>
      {!token && <div className="alert alert-warning">This link is incomplete: open it from the email again.</div>}
      <FieldErrors error={error} />
      <form onSubmit={submit}>
        <NewPassword password={password} confirmation={confirmation} onChange={(p, c) => (setPassword(p), setConfirmation(c))} />
        <button type="submit" className="btn btn-primary w-100" disabled={!token || submitting}>
          {submitting ? 'Saving…' : 'Save password'}
        </button>
      </form>
      <p className="auth-switch">
        Link expired? <Link to="/forgot-password">Ask for a new one</Link>
      </p>
    </div>
  );
}

/** The page the confirmation link opens: confirms at once. */
export function VerifyEmail() {
  const token = useLinkToken();
  const { user, reloadUser } = useAuth();
  const [state, setState] = useState<'checking' | 'done' | 'failed'>('checking');
  const [message, setMessage] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    // once, even when React runs effects twice in development
    if (sent.current) return;
    sent.current = true;
    api('/auth/email/verify', { method: 'POST', body: { token } })
      .then(() => {
        setState('done');
        if (user) void reloadUser();
      })
      .catch((e: Error) => {
        setState('failed');
        setMessage(e.message);
      });
  }, [token, user, reloadUser]);

  if (state === 'done') {
    return (
      <Done title="Email confirmed">
        <p>Thanks, your email address is confirmed.</p>
        <Link className="btn btn-primary" to="/">
          Continue
        </Link>
      </Done>
    );
  }
  return (
    <div className="auth-card">
      <h1>Confirming your email…</h1>
      {state === 'failed' && (
        <div className="alert alert-danger" role="alert">
          {message}
        </div>
      )}
      {state === 'failed' && (user ? <Link to="/">Back to the app (you can send a new link from there)</Link> : <Link to="/login">Log in to send a new link</Link>)}
    </div>
  );
}

/** The page an invitation link opens: choose your name and password, and you're in. */
export function AcceptInvite() {
  const token = useLinkToken();
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{ name: string; email: string } | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<Schemas['InvitationResponse']>('/auth/invitation', { params: { token } })
      .then((found) => {
        setInvite(found);
        setName(found.name);
      })
      .catch((e: Error) => setInvalid(e.message));
  }, [token]);

  if (user && !invite) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      signIn(await api<AuthResponse>('/auth/invitation/accept', { method: 'POST', body: { token, name, password, passwordConfirmation: confirmation } }));
      navigate('/', { replace: true });
    } catch (e) {
      setError(e);
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-card">
      <h1>Welcome to CGT Calculator</h1>
      {invalid ? (
        <div className="alert alert-danger" role="alert">
          {invalid}
        </div>
      ) : (
        <>
          <p className="text-body-secondary">
            {invite ? (
              <>
                Set up your account for <strong>{invite.email}</strong>.
              </>
            ) : (
              'Checking your invitation…'
            )}
          </p>
          <FieldErrors error={error} />
          {invite && (
            <form onSubmit={submit}>
              <div className="mb-3">
                <label htmlFor="name" className="form-label">
                  Your name
                </label>
                <input id="name" className="form-control" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </div>
              <NewPassword password={password} confirmation={confirmation} onChange={(p, c) => (setPassword(p), setConfirmation(c))} />
              <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
                {submitting ? 'Creating your account…' : 'Create my account'}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
