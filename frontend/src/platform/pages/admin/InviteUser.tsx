import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../api';
import AdminPage from '../../components/AdminPage';
import FieldErrors from '../../components/FieldErrors';
import ShareLink, { type LinkResult } from '../../components/ShareLink';
import type { Page } from '../../types';
import type { RoleDto } from './Roles';
import type { UserDto } from './Users';

/** Invite someone by email: they get a link to choose their own password, with the roles picked here. */
export default function InviteUser() {
  const [roles, setRoles] = useState<string[]>([]);
  const [form, setForm] = useState({ email: '', name: '', roles: ['investor'] });
  const [result, setResult] = useState<(LinkResult & { user: UserDto }) | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Page<RoleDto>>('/roles', { params: { size: '100' } })
      .then((page) => setRoles(page.content.map((r) => r.name)))
      .catch(setError);
  }, []);

  const toggle = (role: string) =>
    setForm((f) => ({ ...f, roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role] }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      setResult(await api<LinkResult & { user: UserDto }>('/users/invitations', { method: 'POST', body: form }));
    } catch (e) {
      setError(e);
    }
  };

  return (
    <AdminPage title="Invite User" back="/users">
      {result ? (
        <>
          <ShareLink link={result} to={result.user.email} what="invitation" />
          <button
            type="button"
            className="btn btn-link px-0"
            onClick={() => {
              setResult(null);
              setForm({ email: '', name: '', roles: ['investor'] });
            }}
          >
            Invite someone else
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="admin-form">
          <FieldErrors error={error} />
          <div className="mb-3">
            <label htmlFor="invite-email" className="form-label">
              Email
            </label>
            <input id="invite-email" type="email" className="form-control" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="mb-3">
            <label htmlFor="invite-name" className="form-label">
              Name <span className="text-body-secondary">(optional, they can change it)</span>
            </label>
            <input id="invite-name" className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <fieldset className="mb-4">
            <legend className="form-label fs-6">Roles</legend>
            {roles.map((role) => (
              <div key={role} className="form-check">
                <input id={`invite-role-${role}`} type="checkbox" className="form-check-input" checked={form.roles.includes(role)} onChange={() => toggle(role)} />
                <label htmlFor={`invite-role-${role}`} className="form-check-label">
                  {role}
                </label>
              </div>
            ))}
          </fieldset>
          <button type="submit" className="btn btn-primary">
            Send invitation
          </button>
        </form>
      )}
    </AdminPage>
  );
}
