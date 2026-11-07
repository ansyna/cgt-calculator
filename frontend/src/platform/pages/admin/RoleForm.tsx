import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import AdminPage from '../../components/AdminPage';
import { api } from '../../api';
import FieldErrors from '../../components/FieldErrors';
import type { PermissionDto, RoleDto } from './Roles';

/** Create or edit a role (roles/create.blade.php and roles/edit.blade.php). */
export default function RoleForm() {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const [permissions, setPermissions] = useState<PermissionDto[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<PermissionDto[]>('/permissions').then(setPermissions).catch(setError);
    if (editing) {
      api<RoleDto>(`/roles/${id}`)
        .then((role) => {
          setName(role.name);
          setSelected(role.permissions.map((p) => p.id));
        })
        .catch(setError);
    }
  }, [id, editing]);

  const toggle = (permissionId: number) =>
    setSelected((current) => (current.includes(permissionId) ? current.filter((p) => p !== permissionId) : [...current, permissionId]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api(editing ? `/roles/${id}` : '/roles', { method: editing ? 'PUT' : 'POST', body: { name, permission: selected } });
      navigate('/roles', { state: { success: editing ? 'Role updated successfully' : 'Role created successfully' } });
    } catch (e) {
      setError(e);
    }
  };

  return (
    <AdminPage title={editing ? 'Edit Role' : 'Create New Role'} back="/roles">
      <FieldErrors error={error} />
      <form onSubmit={submit}>
        <div className="mb-3">
          <label htmlFor="name" className="form-label fw-bold">
            Name:
          </label>
          <input id="name" className="form-control" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="mb-3">
          <div className="fw-bold mb-1">Permission:</div>
          {permissions.map((permission) => (
            <div className="form-check" key={permission.id}>
              <input
                id={`permission-${permission.id}`}
                type="checkbox"
                className="form-check-input"
                checked={selected.includes(permission.id)}
                onChange={() => toggle(permission.id)}
              />
              <label htmlFor={`permission-${permission.id}`} className="form-check-label">
                {permission.name}
              </label>
            </div>
          ))}
        </div>
        <button type="submit" className="btn btn-primary">
          Submit
        </button>
      </form>
    </AdminPage>
  );
}
