import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../api';
import AdminPage from '../../components/AdminPage';
import Pagination from '../../components/Pagination';
import type { Page, Schemas } from '../../types';

type Entry = Schemas['EntryDto'];

export const ACTIONS: Record<string, string> = {
  login: 'Logged in',
  'login.failed': 'Failed login',
  'login.throttled': 'Login blocked (too many attempts)',
  logout: 'Logged out',
  register: 'Signed up',
  'email.verified': 'Confirmed email',
  'password.reset-requested': 'Asked for a password reset',
  'password.reset-link': 'Created a password reset link',
  'password.reset': 'Reset password',
  'invitation.sent': 'Invited',
  'invitation.accepted': 'Accepted invitation',
  'user.approved': 'Approved sign-up',
  'user.created': 'Created user',
  'user.updated': 'Updated user',
  'user.deleted': 'Deleted user',
  'user.renamed': 'Changed their name',
  'role.created': 'Created role',
  'role.updated': 'Updated role',
  'role.deleted': 'Deleted role',
  'session.reuse-detected': 'Copied login token detected',
};

const FILTERS: [string, string][] = [
  ['', 'Everything'],
  ['login', 'Logins'],
  ['password', 'Passwords'],
  ['invitation', 'Invitations'],
  ['user', 'Users'],
  ['role', 'Roles'],
  ['session', 'Security'],
];

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Who did what: logins, password resets, invitations, approvals and changes to users and roles. */
export default function Activity() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') ?? '0');
  const type = searchParams.get('type') ?? '';
  const [data, setData] = useState<Page<Entry> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Page<Entry>>('/activity', { params: { page: String(page), type } })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [page, type]);

  return (
    <AdminPage
      title="Activity"
      actions={
        <select className="form-select form-select-sm w-auto" aria-label="Show" value={type} onChange={(e) => setSearchParams(e.target.value ? { type: e.target.value } : {})}>
          {FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      }
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {data && data.content.length === 0 && <p className="text-body-secondary">Nothing recorded yet.</p>}
      {data && data.content.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table admin-table activity-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((entry) => (
                  <tr key={entry.id} className={entry.action.endsWith('failed') || entry.action.startsWith('session') || entry.action.endsWith('throttled') ? 'activity-warning' : ''}>
                    <td className="activity-when text-nowrap">{when.format(new Date(entry.at))}</td>
                    <td>{entry.actor || <span className="text-body-secondary">not logged in</span>}</td>
                    <td className="activity-what">
                      {ACTIONS[entry.action] ?? entry.action}
                      {entry.target && entry.target !== entry.actor && <span className="activity-target"> {entry.target}</span>}
                    </td>
                    <td className="activity-details">{entry.details}</td>
                    <td className="activity-ip text-body-secondary">{entry.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onChange={(p) => setSearchParams(type ? { type, page: String(p) } : { page: String(p) })}
          />
        </>
      )}
    </AdminPage>
  );
}
