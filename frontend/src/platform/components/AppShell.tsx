import { History, LayoutDashboard, LogOut, Menu, Moon, RotateCw, Sun, UserCog, Users, Wallet, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { appForPath, useApps, type AppDefinition } from '../apps';
import { INVESTOR_ROLES, useAuth } from '../auth';
import { applyTheme, useTheme, type Theme } from '../preferences';
import ErrorBoundary from './ErrorBoundary';
import VerifyEmailBanner from './VerifyEmailBanner';

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="btn btn-icon"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setTheme(next)}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/** The sidebar of an app without its own menu: its start page. */
function OverviewMenu({ app, onNavigate }: { app: AppDefinition; onNavigate: () => void }) {
  return (
    <div className="nav-group">
      <div className="nav-group-title">{app.name}</div>
      <NavLink to={app.path} end className="nav-item-link" onClick={onNavigate}>
        <LayoutDashboard size={17} aria-hidden />
        <span>Overview</span>
      </NavLink>
    </div>
  );
}

/** The current app's pages; the administration is the same in every app. */
function Sidebar({ app, onNavigate }: { app: AppDefinition; onNavigate: () => void }) {
  const { can, hasRole } = useAuth();
  const investor = hasRole(...INVESTOR_ROLES);

  return (
    <nav className="sidebar-nav" aria-label="Tools">
      {investor && (app.Menu ? <app.Menu onNavigate={onNavigate} /> : <OverviewMenu app={app} onNavigate={onNavigate} />)}
      {(can('user-create') || can('role-create')) && (
        <div className="nav-group">
          <div className="nav-group-title">Administration</div>
          {can('user-create') && (
            <NavLink to="/users" className="nav-item-link" onClick={onNavigate}>
              <Users size={17} aria-hidden />
              <span>Users</span>
            </NavLink>
          )}
          {can('role-create') && (
            <NavLink to="/roles" className="nav-item-link" onClick={onNavigate}>
              <UserCog size={17} aria-hidden />
              <span>Roles</span>
            </NavLink>
          )}
          {hasRole('admin') && (
            <NavLink to="/activity" className="nav-item-link" onClick={onNavigate}>
              <History size={17} aria-hidden />
              <span>Activity</span>
            </NavLink>
          )}
        </div>
      )}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark">
        <Wallet size={18} aria-hidden />
      </span>
      <span>CGT Calculator</span>
    </Link>
  );
}

/** Whether the sidebar is an off-canvas menu (below Bootstrap's lg breakpoint), rather than always shown. */
function useNarrowScreen(): boolean {
  const query = '(max-width: 991.98px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media?.addEventListener) return;
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** Signed-in layout: sidebar with the calculator's pages, top bar with the theme toggle and account. */
export default function AppShell() {
  const { user, loading, offline, retry, hasRole, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const narrow = useNarrowScreen();
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  // the app of the page; pages all apps share (administration) stay in the app they were opened from
  const apps = useApps();
  const pageApp = appForPath(apps, location.pathname);
  const [app, setApp] = useState<AppDefinition>(pageApp ?? apps[0]);
  if (pageApp && pageApp !== app) setApp(pageApp);
  const investor = hasRole(...INVESTOR_ROLES);

  // another page closes the menu (also when reached with the back button)
  const [menuPath, setMenuPath] = useState(location.pathname);
  if (menuPath !== location.pathname) {
    setMenuPath(location.pathname);
    setMenuOpen(false);
  }

  // the open menu: focus its first link, Escape closes it and returns to the menu button
  useEffect(() => {
    if (!menuOpen || !narrow) return;
    sidebar.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, narrow]);

  // while a saved session is checked, render nothing rather than flashing the signed-out layout
  if (loading) return null;

  if (!user && offline) {
    return (
      <div className="auth-layout">
        <div className="auth-top">
          <Brand />
          <ThemeToggle />
        </div>
        <div className="state-card state-error" role="alert">
          <WifiOff size={28} aria-hidden />
          <div>
            <div className="state-title">Can't reach the server</div>
            <div className="state-text">Check your connection. You stay logged in.</div>
            <button type="button" className="btn btn-sm btn-outline-primary mt-2" onClick={retry}>
              <RotateCw size={14} aria-hidden /> Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-layout">
        <div className="auth-top">
          <Brand />
          <ThemeToggle />
        </div>
        <ErrorBoundary key={location.pathname} resetKey={location.search}>
          <Outlet />
        </ErrorBoundary>
      </div>
    );
  }

  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
      {/* closed on a phone: out of the tab order and hidden from screen readers */}
      <aside className="sidebar" id="app-menu" ref={sidebar} inert={narrow && !menuOpen} aria-label="Menu">
        <div className="sidebar-header">
          <Brand />
          <button type="button" className="btn btn-icon d-lg-none" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <Sidebar app={app} onNavigate={() => setMenuOpen(false)} />
        {investor && app.MenuFooter && <app.MenuFooter />}
      </aside>
      <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-hidden />
      <div className="app-main">
        <header className="topbar">
          <button
            type="button"
            ref={menuButton}
            className="btn btn-icon d-lg-none"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="app-menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="topbar-search">{investor && app.TopBar && <app.TopBar />}</div>
          <ThemeToggle />
          <div className="user-chip" title={user.email}>
            <span className="avatar" aria-hidden>
              {initials}
            </span>
            <span className="d-none d-md-inline">{user.name}</span>
          </div>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Log out"
            title="Log out"
            onClick={async () => {
              const ended = await logout();
              navigate('/login', { state: ended ? undefined : { logoutFailed: true } });
            }}
          >
            <LogOut size={18} />
          </button>
        </header>
        <main className="content">
          <VerifyEmailBanner />
          {/* a new boundary per page, and another ticker or option tries the page again */}
          <ErrorBoundary key={location.pathname} resetKey={location.search}>
            <Outlet />
          </ErrorBoundary>
        </main>
        <footer className="app-footer">
          © {new Date().getFullYear()} by Hanna G.
          {app.credit}
        </footer>
      </div>
    </div>
  );
}
