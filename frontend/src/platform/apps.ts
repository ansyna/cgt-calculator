import type { LucideIcon } from 'lucide-react';
import { createContext, useContext, type ComponentType, type JSX, type ReactNode } from 'react';

/** How an app is shown in the switcher. */
export interface AppInfo {
  id: string;
  name: string;
  /** In the switcher's button on a phone. */
  shortName: string;
  description: string;
  icon: LucideIcon;
  /** Where the app opens. */
  path: string;
}

export interface AppRoute {
  path: string;
  element: JSX.Element;
  /** Who may open it: any of these roles; omitted, anyone logged in; 'public', anyone. */
  access?: string[] | 'public';
}

/**
 * An app within the app: its pages, and what it adds to the shared layout. The layout, the switcher and the routes
 * are built from the list of apps (src/apps), so an app plugs in without the shared code knowing it.
 */
export interface AppDefinition extends AppInfo {
  routes: AppRoute[];
  /** Whether a page belongs to the app; by default its start page and the pages under it. */
  ownsPath?: (pathname: string) => boolean;
  /** The app's part of the sidebar; by default a link to its start page. */
  Menu?: ComponentType<{ onNavigate: () => void }>;
  /** In the top bar next to the app switcher. */
  TopBar?: ComponentType;
  /** At the bottom of the sidebar. */
  MenuFooter?: ComponentType;
  /** After the copyright in the footer (a data provider's credit). */
  credit?: ReactNode;
}

/**
 * The app a page belongs to; null for pages every app shares (administration), which stay in the app they were
 * opened from.
 */
export function appForPath(apps: AppDefinition[], pathname: string): AppDefinition | null {
  return (
    apps.find((app) => (app.ownsPath ? app.ownsPath(pathname) : pathname === app.path || pathname.startsWith(`${app.path}/`))) ??
    null
  );
}

export const AppsContext = createContext<AppDefinition[]>([]);

/** The apps, the first being the one a session starts in. */
export function useApps(): AppDefinition[] {
  return useContext(AppsContext);
}
