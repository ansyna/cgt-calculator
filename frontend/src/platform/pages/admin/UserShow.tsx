import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import AdminPage from '../../components/AdminPage';
import { api } from '../../api';
import { useAuth } from '../../auth';
import ShareLink, { type LinkResult } from '../../components/ShareLink';
import type { UserDto } from './Users';

export default function UserShow() {
  const { id } = useParams();
  const [user, setUser] = useState<UserDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<LinkResult | null>(null);
  const { can } = useAuth();

  const createResetLink = async () => {
    try {
      setResetLink(await api<LinkResult>(`/users/${id}/password-reset`, { method: 'POST' }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    api<UserDto>(`/users/${id}`)
      .then(setUser)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <AdminPage title="Show User" back="/users">
      {error && <div className="alert alert-danger">{error}</div>}
      {user && (
        <>
          <p>
            <strong>Name:</strong> {user.name}
          </p>
          <p>
            <strong>Email:</strong> {user.email}
          </p>
          <p>
            <strong>Roles:</strong>{' '}
            {user.roles.map((role) => (
              <span key={role} className="role-badge">
                {role}
              </span>
            ))}
          </p>
          {user.invitationPending && <p className="text-body-secondary">Invited; hasn't accepted yet.</p>}
          {user.emailVerified === false && <p className="text-body-secondary">Hasn't confirmed the email address yet.</p>}
          {can('user-edit') && !user.invitationPending && (
            <div className="mt-3">
              {resetLink ? (
                <ShareLink link={resetLink} to={user.email} what="password reset link" />
              ) : (
                <button type="button" className="btn btn-outline-primary" onClick={createResetLink}>
                  <KeyRound size={16} aria-hidden /> Password reset link
                </button>
              )}
            </div>
          )}
        </>
      )}
    </AdminPage>
  );
}
