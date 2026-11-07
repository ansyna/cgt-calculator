import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import AdminPage from '../../components/AdminPage';
import { api } from '../../api';
import FieldErrors from '../../components/FieldErrors';
import type { Page } from '../../types';
import type { RoleDto } from './Roles';
import type { UserDto } from './Users';

/** Create or edit a user (users/create.blade.php and users/edit.blade.php). */
export default function UserForm() {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const [roles, setRoles] = useState<string[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', roles: [] as string[] });
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Page<RoleDto>>('/roles', { params: { size: '100' } })
      .then((page) => setRoles(page.content.map((r) => r.name)))
      .catch(setError);
    if (editing) {
      api<UserDto>(`/users/${id}`)
        .then((user) => setForm((f) => ({ ...f, name: user.name, email: user.email, roles: user.roles })))
        .catch(setError);
    }
  }, [id, editing]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await api(editing ? `/users/${id}` : '/users', { method: editing ? 'PUT' : 'POST', body: form });
      navigate('/users', { state: { success: editing ? 'User updated successfully' : 'User created successfully' } });
    } catch (e) {
      setError(e);
    }
  };

  const text = (name: 'name' | 'email' | 'password' | 'confirmPassword', label: string, type = 'text') => (
    <div className="mb-3">
      <label htmlFor={name} className="form-label fw-bold">
        {label}:
      </label>
      <input
        id={name}
        type={type}
        placeholder={label}
        className="form-control"
        value={form[name]}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
      />
    </div>
  );

  return (
    <AdminPage title={editing ? 'Edit User' : 'Create New User'} back="/users">
      <FieldErrors error={error} />
      <form onSubmit={submit}>
        {text('name', 'Name')}
        {text('email', 'Email', 'email')}
        {text('password', 'Password', 'password')}
        {text('confirmPassword', 'Confirm Password', 'password')}
        <div className="mb-3">
          <label htmlFor="roles" className="form-label fw-bold">
            Role:
          </label>
          <select
            id="roles"
            multiple
            className="form-select"
            value={form.roles}
            onChange={(e) => setForm({ ...form, roles: Array.from(e.target.selectedOptions, (o) => o.value) })}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          Submit
        </button>
      </form>
    </AdminPage>
  );
}
