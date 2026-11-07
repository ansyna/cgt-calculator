import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import AdminPage from '../../components/AdminPage';
import { api } from '../../api';
import type { RoleDto } from './Roles';

export default function RoleShow() {
  const { id } = useParams();
  const [role, setRole] = useState<RoleDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<RoleDto>(`/roles/${id}`)
      .then(setRole)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <AdminPage title="Show Role" back="/roles">
      {error && <div className="alert alert-danger">{error}</div>}
      {role && (
        <>
          <p>
            <strong>Name:</strong> {role.name}
          </p>
          <p>
            <strong>Permissions:</strong>{' '}
            {role.permissions.map((p) => (
              <span key={p.id} className="role-badge">
                {p.name}
              </span>
            ))}
          </p>
        </>
      )}
    </AdminPage>
  );
}
