import { useCallback, useEffect, useState } from 'react';
import { Check, Eye, Mail, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';
import AdminPage from '../../components/AdminPage';
import { useConfirm } from '../../components/ConfirmDialog';
import Pagination from '../../components/Pagination';
import type { Page, Schemas } from '../../types';

export type UserDto = Schemas['UserDto'];

const joined = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** Sign-ups waiting for an admin: approve (investor) or reject (delete). */
function PendingApprovals({ onChange }: { onChange: (message: string) => void }) {
  const { can } = useAuth();
  const [pending, setPending] = useState<UserDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    api<UserDto[]>('/users/pending').then((list) => setPending(Array.isArray(list) ? list : [])).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (pending.length === 0 && !error) return null;

  const approve = async (user: UserDto) => {
    try {
      await api(`/users/${user.id}/approve`, { method: 'POST', body: { roles: ['investor'] } });
      onChange(`${user.name} can now use the calculator`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const reject = async (user: UserDto) => {
    const sure = await confirm({ title: `Reject ${user.name}'s sign-up?`, message: 'Their account is deleted.', confirmLabel: 'Reject', danger: true });
    if (!sure) return;
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' });
      onChange(`${user.name}'s sign-up was rejected`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="pending-approvals" aria-labelledby="pending-title">
      {dialog}
      <h2 id="pending-title">Waiting for approval ({pending.length})</h2>
      {error && <div className="alert alert-danger">{error}</div>}
      <ul>
        {pending.map((user) => (
          <li key={user.id}>
            <div>
              <strong>{user.name}</strong> <span className="text-body-secondary">{user.email}</span>
              {user.emailVerified === false && <span className="status-badge">email not confirmed</span>}
              {user.createdAt && <div className="text-body-secondary small">Signed up {joined.format(new Date(user.createdAt))}</div>}
            </div>
            <div className="text-nowrap">
              {can('user-edit') && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => approve(user)} aria-label={`Approve ${user.name}`}>
                  <Check size={14} aria-hidden /> Approve
                </button>
              )}{' '}
              {can('user-delete') && (
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => reject(user)} aria-label={`Reject ${user.name}`}>
                  <X size={14} aria-hidden /> Reject
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Users() {
  const { can, user: me } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') ?? '0');
  const [data, setData] = useState<Page<UserDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>((location.state as { success?: string } | null)?.success ?? null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    api<Page<UserDto>>('/users', { params: { page: String(page) } })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [page]);

  useEffect(load, [load]);

  const remove = async (user: UserDto) => {
    const sure = await confirm({
      title: `Delete ${user.name}?`,
      message: "Their account and everything they recorded are deleted. This can't be undone.",
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!sure) return;
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' });
      setMessage('User deleted successfully');
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {dialog}
      <AdminPage
        title="Users"
        actions={
          can('user-create') && (
            <div className="d-flex flex-wrap gap-2">
              <Link className="btn btn-outline-primary" to="/users/invite">
                <Mail size={16} aria-hidden /> Invite User
              </Link>
              <Link className="btn btn-primary" to="/users/create">
                <Plus size={16} aria-hidden /> Create New User
              </Link>
            </div>
          )
        }
      >
        <PendingApprovals
          onChange={(text) => {
            setMessage(text);
            load();
          }}
        />
        {message && <div className="alert alert-success">{message}</div>}
        {error && <div className="alert alert-danger">{error}</div>}
        {data && (
          <>
            <div className="table-wrap">
            <table className="table admin-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((user, i) => (
                  <tr key={user.id}>
                    <td>{data.page * data.size + i + 1}</td>
                    <td>{user.name}</td>
                    <td>
                      {user.email}
                      {user.invitationPending && <span className="status-badge">invited</span>}
                      {user.emailVerified === false && <span className="status-badge">email not confirmed</span>}
                    </td>
                    <td>
                      {user.roles.map((role) => (
                        <span key={role} className="role-badge">
                          {role}
                        </span>
                      ))}
                    </td>
                    <td className="text-end text-nowrap">
                      <Link className="btn btn-icon" to={`/users/${user.id}`} aria-label={`Show ${user.name}`} title="Show">
                        <Eye size={16} />
                      </Link>
                      {can('user-edit') && (
                        <Link className="btn btn-icon" to={`/users/${user.id}/edit`} aria-label={`Edit ${user.name}`} title="Edit">
                          <Pencil size={16} />
                        </Link>
                      )}
                      {can('user-delete') && user.id !== me?.id && (
                        <button type="button" className="btn btn-icon text-danger" onClick={() => remove(user)} aria-label={`Delete ${user.name}`} title="Delete">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} onChange={(p) => setSearchParams({ page: String(p) })} />
          </>
        )}
      </AdminPage>
    </>
  );
}
