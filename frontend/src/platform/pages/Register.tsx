import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth';
import FieldErrors from '../components/FieldErrors';

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', passwordConfirmation: '' });
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register(form.name, form.email, form.password, form.passwordConfirmation);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const field = (name: keyof typeof form, label: string, type: string, autoComplete: string, hint?: string) => (
    <div className="mb-3">
      <label htmlFor={name} className="form-label">
        {label}
      </label>
      <input
        id={name}
        type={type}
        className="form-control"
        value={form[name]}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
        required
        minLength={type === 'password' ? 8 : undefined}
        autoComplete={autoComplete}
      />
      {hint && <div className="form-text">{hint}</div>}
    </div>
  );

  return (
    <div className="auth-card">
      <h1>Create an account</h1>
      <p className="text-body-secondary">An administrator will give you access to the tools.</p>
      <FieldErrors error={error} />
      <form onSubmit={submit}>
        {field('name', 'Name', 'text', 'name')}
        {field('email', 'E-Mail Address', 'email', 'email')}
        {field('password', 'Password', 'password', 'new-password', 'At least 8 characters')}
        {field('passwordConfirmation', 'Confirm Password', 'password', 'new-password')}
        <button type="submit" className="btn btn-primary w-100 mt-2" disabled={submitting}>
          {submitting ? 'Creating your account…' : 'Register'}
        </button>
      </form>
      <p className="auth-switch">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
