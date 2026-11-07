import type { JSX } from 'react';
import { Route, Routes } from 'react-router';
import { APPS } from './apps';
import { AppsContext, type AppRoute } from './platform/apps';
import { ADMIN_ROLES } from './platform/auth';
import AppShell from './platform/components/AppShell';
import RequireAuth from './platform/components/RequireAuth';
import { lazyPage } from './platform/lazyPage';
import { onDemand } from './platform/onDemand';
import Login from './platform/pages/Login';
import Register from './platform/pages/Register';

// Loaded when first opened: the admin pages are for admins only, and the email-link pages are opened once in a
// while. After a deploy, a tab opened before it reloads to get them (lazyPage)
const Users = lazyPage(() => import('./platform/pages/admin/Users'));
const UserForm = lazyPage(() => import('./platform/pages/admin/UserForm'));
const UserShow = lazyPage(() => import('./platform/pages/admin/UserShow'));
const InviteUser = lazyPage(() => import('./platform/pages/admin/InviteUser'));
const Activity = lazyPage(() => import('./platform/pages/admin/Activity'));
const Roles = lazyPage(() => import('./platform/pages/admin/Roles'));
const RoleForm = lazyPage(() => import('./platform/pages/admin/RoleForm'));
const RoleShow = lazyPage(() => import('./platform/pages/admin/RoleShow'));
const ForgotPassword = lazyPage(() => import('./platform/pages/account').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazyPage(() => import('./platform/pages/account').then((m) => ({ default: m.ResetPassword })));
const VerifyEmail = lazyPage(() => import('./platform/pages/account').then((m) => ({ default: m.VerifyEmail })));
const AcceptInvite = lazyPage(() => import('./platform/pages/account').then((m) => ({ default: m.AcceptInvite })));

const adminRoutes: [string, JSX.Element][] = [
  ['/users', onDemand(<Users />)],
  ['/users/create', onDemand(<UserForm />)],
  ['/users/invite', onDemand(<InviteUser />)],
  ['/activity', onDemand(<Activity />)],
  ['/users/:id', onDemand(<UserShow />)],
  ['/users/:id/edit', onDemand(<UserForm />)],
  ['/roles', onDemand(<Roles />)],
  ['/roles/create', onDemand(<RoleForm />)],
  ['/roles/:id', onDemand(<RoleShow />)],
  ['/roles/:id/edit', onDemand(<RoleForm />)],
];

/** An app's page behind its access rule. */
function guarded({ element, access }: AppRoute) {
  return access === 'public' ? element : <RequireAuth roles={access}>{element}</RequireAuth>;
}

export default function App() {
  return (
    <AppsContext.Provider value={APPS}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={onDemand(<ForgotPassword />)} />
          <Route path="/reset-password" element={onDemand(<ResetPassword />)} />
          <Route path="/verify-email" element={onDemand(<VerifyEmail />)} />
          <Route path="/accept-invite" element={onDemand(<AcceptInvite />)} />
          {APPS.flatMap((app) => app.routes).map((route) => (
            <Route key={route.path} path={route.path} element={guarded(route)} />
          ))}
          {adminRoutes.map(([path, element]) => (
            <Route key={path} path={path} element={<RequireAuth roles={ADMIN_ROLES}>{element}</RequireAuth>} />
          ))}
          <Route path="*" element={<div className="state-card">Page not found.</div>} />
        </Route>
      </Routes>
    </AppsContext.Provider>
  );
}
