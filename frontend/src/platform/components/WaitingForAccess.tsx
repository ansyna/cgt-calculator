import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Schemas } from '../types';

/** For someone signed up whom an administrator hasn't given access yet: who to ask. */
export default function WaitingForAccess() {
  const [contactEmail, setContactEmail] = useState('');

  useEffect(() => {
    api<Schemas['ClientConfig']>('/config')
      .then((config) => setContactEmail(config.contactEmail))
      .catch(() => undefined);
  }, []);

  return (
    <div className="state-card no-access">
      <Lock size={28} aria-hidden />
      <div>
        <div className="state-title">Waiting for access</div>
        <div className="state-text">
          Your account is set up, but an administrator still has to give you access to the calculator.
          {contactEmail ? (
            <>
              {' '}
              Contact admin at <a href={`mailto:${contactEmail}`}>{contactEmail}</a> for access to the site.
            </>
          ) : (
            ' Contact the site admin for access.'
          )}
        </div>
      </div>
    </div>
  );
}
