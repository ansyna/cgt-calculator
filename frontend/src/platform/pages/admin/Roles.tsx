import { useCallback, useEffect, useState } from 'react';
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { api } from '../../api';
import { useAuth } from '../../auth';
import AdminPage from '../../components/AdminPage';
import { useConfirm } from '../../components/ConfirmDialog';
import Pagination from '../../components/Pagination';
import type { Page, Schemas } from '../../types';

export type PermissionDto = Schemas['PermissionDto'];

export type RoleDto = Schemas['RoleDto'];

export default function Roles() {
  const { confirm, dialog } = useConfirm();
  const { can } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') ?? '0');
  const [data, setData] = useState<Page<RoleDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>((location.state as { success?: string } | null)?.success ?? null);

  const load = useCallback(() => {
    api<Page<RoleDto>>('/roles', { params: { page: String(page) } })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [page]);

  useEffect(load, [load]);

  const remove = async (role: RoleDto) => {
    const sure = await confirm({
      title: `Delete the role ${role.name}?`,
      message: "Its users lose what it allows. This can't be undone.",
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!sure) return;
    try {
      await api(`/roles/${role.id}`, { method: 'DELETE' });
      setMessage('Role deleted successfully');
      setError(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {dialog}
      <AdminPage
        title="Roles"
        actions={
          can('role-create') && (
            <Link className="btn btn-primary" to="/roles/create">
              <Plus size={16} aria-hidden /> Create New Role
            </Link>
          )
        }
      >
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
                  <th>Permissions</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((role, i) => (
                  <tr key={role.id}>
                    <td>{data.page * data.size + i + 1}</td>
                    <td>
                      <span className="role-badge">{role.name}</span>
                    </td>
                    <td className="text-body-secondary">{role.permissions.length}</td>
                    <td className="text-end text-nowrap">
                      <Link className="btn btn-icon" to={`/roles/${role.id}`} aria-label={`Show ${role.name}`} title="Show">
                        <Eye size={16} />
                      </Link>
                      {can('role-edit') && (
                        <Link className="btn btn-icon" to={`/roles/${role.id}/edit`} aria-label={`Edit ${role.name}`} title="Edit">
                          <Pencil size={16} />
                        </Link>
                      )}
                      {can('role-delete') && role.name !== 'admin' && (
                        <button type="button" className="btn btn-icon text-danger" onClick={() => remove(role)} aria-label={`Delete ${role.name}`} title="Delete">
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
