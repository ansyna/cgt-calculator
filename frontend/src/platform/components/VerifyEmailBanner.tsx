import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

/** Banner for a sign-up that hasn't confirmed its email yet. */
export default function VerifyEmailBanner() {
  const { user } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  if (!user || user.emailVerified !== false) return null;

  const resend = async () => {
    setState('sending');
    try {
      await api('/auth/email/resend', { method: 'POST' });
      setState('sent');
    } catch (e) {
      setState('failed');
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="verify-banner" role="status">
      <MailCheck size={18} aria-hidden />
      <span>
        Please confirm your email address: we sent a link to <strong>{user.email}</strong>.
        {state === 'sent' && ' A new link is on its way.'}
        {state === 'failed' && ` ${message}`}
      </span>
      {state !== 'sent' && (
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={resend} disabled={state === 'sending'}>
          Send again
        </button>
      )}
    </div>
  );
}
